//! Apple Calendar, read through EventKit.
//!
//! Whatever calendars the Mac already has (iCloud, Google, Exchange, local)
//! are visible here without an account, a key, or a network call. The one cost is
//! a macOS permission prompt on first use, driven by `NSCalendarsUsageDescription`
//! in `Info.plist`.

use serde::Serialize;

/// One occurrence, ready for the "Coming up" panel. Times are ISO-8601 local
/// wall-clock strings with no zone suffix, which the webview parses in local time.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Event {
    pub id: String,
    pub summary: String,
    pub start: String,
    pub end: Option<String>,
    pub all_day: bool,
    pub location: Option<String>,
    pub link: Option<String>,
    pub calendar: Option<String>,
}

/// What the UI gets back. `authorized` false means macOS has not granted calendar
/// access yet, which the panel shows as a prompt rather than an error.
#[derive(Debug, Clone, Serialize)]
pub struct CalendarFeed {
    pub authorized: bool,
    pub denied: bool,
    pub events: Vec<Event>,
}

#[cfg(target_os = "macos")]
mod macos_calendar {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObjectProtocol};
    use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEvent, EKEventStore};
    use objc2_foundation::{NSArray, NSDate, NSError, NSString};

    const ACCESS_TIMEOUT: Duration = Duration::from_secs(120);

    pub fn authorization() -> EKAuthorizationStatus {
        unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) }
    }

    pub fn is_authorized() -> bool {
        matches!(authorization(), EKAuthorizationStatus::FullAccess)
    }

    pub fn is_denied() -> bool {
        matches!(
            authorization(),
            EKAuthorizationStatus::Denied | EKAuthorizationStatus::Restricted
        )
    }

    pub fn request_access() -> Result<bool, String> {
        if is_authorized() {
            return Ok(true);
        }
        if is_denied() {
            return Ok(false);
        }

        let store = unsafe { EKEventStore::new() };
        let (tx, rx) = mpsc::channel::<bool>();

        let handler = block2::RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        let handler_ptr =
            &*handler as *const block2::DynBlock<dyn Fn(Bool, *mut NSError)> as *mut _;

        unsafe {
            if store.respondsToSelector(objc2::sel!(requestFullAccessToEventsWithCompletion:)) {
                store.requestFullAccessToEventsWithCompletion(handler_ptr);
            } else {
                #[allow(deprecated)]
                store.requestAccessToEntityType_completion(EKEntityType::Event, handler_ptr);
            }
        }

        match rx.recv_timeout(ACCESS_TIMEOUT) {
            Ok(granted) => Ok(granted),
            Err(_) => Err("timed out waiting for calendar permission prompt".into()),
        }
    }

    pub fn list_events(days: u32) -> Result<CalendarFeed, String> {
        if !is_authorized() {
            return Ok(CalendarFeed {
                authorized: false,
                denied: is_denied(),
                events: Vec::new(),
            });
        }

        let events = unsafe {
            let store = EKEventStore::new();
            let start = NSDate::dateWithTimeIntervalSinceNow(-86_400.0);
            let end = NSDate::dateWithTimeIntervalSinceNow(86_400.0 * f64::from(days));
            let predicate =
                store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None);
            let matching: Retained<NSArray<EKEvent>> = store.eventsMatchingPredicate(&predicate);

            let mut out = Vec::with_capacity(matching.len());
            for event in matching.iter() {
                if let Some(mapped) = map_event(&event) {
                    out.push(mapped);
                }
            }
            out
        };

        Ok(CalendarFeed {
            authorized: true,
            denied: false,
            events,
        })
    }

    unsafe fn map_event(event: &EKEvent) -> Option<Event> {
        let all_day = event.isAllDay();
        let start = iso_local(&event.startDate(), all_day);
        let title = event.title().to_string();

        Some(Event {
            id: event
                .eventIdentifier()
                .map(|s| s.to_string())
                .unwrap_or_default(),
            summary: if title.trim().is_empty() {
                "(no title)".into()
            } else {
                title
            },
            start,
            end: Some(iso_local(&event.endDate(), all_day)),
            all_day,
            location: event
                .location()
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty()),
            link: join_link(event),
            calendar: event.calendar().and_then(|c| {
                let name = c.title().to_string();
                (!name.trim().is_empty()).then_some(name)
            }),
        })
    }

    unsafe fn join_link(event: &EKEvent) -> Option<String> {
        if let Some(url) = event.URL() {
            let text = url
                .absoluteString()
                .map(|s| s.to_string())
                .unwrap_or_default();
            if text.starts_with("http://") || text.starts_with("https://") {
                return Some(text);
            }
        }
        let notes = event.notes()?.to_string();
        notes
            .split_whitespace()
            .find(|word| word.starts_with("https://"))
            .map(|word| word.trim_end_matches(['>', ')', ',', '.']).to_string())
    }

    unsafe fn iso_local(date: &NSDate, all_day: bool) -> String {
        let formatter = objc2_foundation::NSDateFormatter::new();
        let pattern = if all_day {
            "yyyy-MM-dd"
        } else {
            "yyyy-MM-dd'T'HH:mm:ss"
        };
        formatter.setDateFormat(Some(&NSString::from_str(pattern)));
        formatter.setTimeZone(Some(&objc2_foundation::NSTimeZone::localTimeZone()));
        formatter.stringFromDate(date).to_string()
    }
}

#[cfg(target_os = "macos")]
pub use macos_calendar::*;

#[cfg(not(target_os = "macos"))]
pub fn is_authorized() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn request_access() -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(target_os = "macos"))]
pub fn list_events(_days: u32) -> Result<CalendarFeed, String> {
    Ok(CalendarFeed {
        authorized: false,
        denied: false,
        events: Vec::new(),
    })
}

pub fn authorized() -> bool {
    is_authorized()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feed_structure_serializes() {
        let feed = CalendarFeed {
            authorized: true,
            denied: false,
            events: vec![Event {
                id: "123".into(),
                summary: "Sync".into(),
                start: "2026-09-04T10:00:00".into(),
                end: Some("2026-09-04T10:30:00".into()),
                all_day: false,
                location: Some("Room A".into()),
                link: Some("https://meet.google.com/abc-defg-hij".into()),
                calendar: Some("Work".into()),
            }],
        };
        let s = serde_json::to_string(&feed).unwrap();
        assert!(s.contains("Sync"));
        assert!(s.contains("Room A"));
    }

    #[test]
    fn authorized_check_does_not_panic() {
        let _ = authorized();
    }
}

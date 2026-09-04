import { useEffect, useRef, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card, Dot, PageTitle } from "./ui";
import { ActionError, useAction } from "./useAction";
import { Icon } from "./icons";
import {
  startSession,
  stopSession,
  isSessionActive,
  sessionElapsedMs,
  getLiveLines,
  getStatus,
  requestScreenRecording,
  askMeeting,
  listEvents,
  calendarRequestAccess,
  openCalendarSettings,
  videoProbe,
  videoImport,
  type LiveLine,
  type MeetingResult,
  type Status,
  type CalendarFeed,
  type CalendarEvent,
  type VideoInfo,
} from "./api";

function formatDuration(ms: number): string {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatTimestamp(atMs: number): string {
  const totalSecs = Math.max(0, Math.floor(atMs / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatEventTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (isToday) return `Today ${timeStr}`;
    return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${timeStr}`;
  } catch {
    return iso;
  }
}

export function MeetingsPane() {
  const [active, setActive] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveLines, setLiveLines] = useState<LiveLine[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [lastResult, setLastResult] = useState<MeetingResult | null>(null);
  const [liveQuestion, setLiveQuestion] = useState("");
  const [liveAnswer, setLiveAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [ending, setEnding] = useState(false);

  // Calendar state
  const [calendarFeed, setCalendarFeed] = useState<CalendarFeed | null>(null);
  const [requestingCalendar, setRequestingCalendar] = useState(false);

  // Media / Video Import state
  const [showVideoImport, setShowVideoImport] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoStartTime, setVideoStartTime] = useState("00:00");
  const [videoEndTime, setVideoEndTime] = useState("10:00");
  const [probingVideo, setProbingVideo] = useState(false);
  const [importingVideo, setImportingVideo] = useState(false);
  const [videoImportNotice, setVideoImportNotice] = useState<string | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const { error, clearError, run } = useAction();

  const loadCalendar = async () => {
    try {
      const feed = await listEvents(7);
      setCalendarFeed(feed);
    } catch {
      // Calendar unavailable or denied
    }
  };

  // Reconcile active session on mount and listen for live lines
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const isAct = await isSessionActive();
      if (!mounted) return;
      setActive(isAct);

      if (isAct) {
        const ms = await sessionElapsedMs();
        if (!mounted) return;
        if (ms !== null) setElapsedMs(ms);
      }

      const lines = await getLiveLines();
      if (!mounted) return;
      setLiveLines(lines);

      const s = await getStatus();
      if (!mounted) return;
      setStatus(s);

      void loadCalendar();
    };

    void init();

    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        if (!mounted) return;
        return listen<LiveLine>("whimpr://live-line", (e) => {
          if (!mounted) return;
          setLiveLines((prev) => [...prev, e.payload]);
        });
      })
      .then((u) => {
        if (mounted) {
          unlisten = u;
        } else {
          u?.();
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // Poll elapsed duration while active
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const ms = await sessionElapsedMs();
      if (ms !== null) {
        setElapsedMs(ms);
      } else {
        const stillActive = await isSessionActive();
        if (!stillActive) {
          setActive(false);
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  // Scroll transcript down as lines arrive
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveLines.length]);

  const handleStart = async (customTitle?: string) => {
    clearError();
    setLastResult(null);
    setLiveAnswer(null);

    const now = new Date();
    const defaultTitle = `Meeting ${now.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })} ${now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    const meetingTitle = customTitle?.trim() || titleInput.trim() || defaultTitle;

    const ok = await run(async () => {
      await startSession(meetingTitle, "en");
      setActive(true);
      setElapsedMs(0);
      setLiveLines([]);
    });
    if (ok) {
      setTitleInput("");
    }
  };

  const handleStop = async () => {
    clearError();
    setEnding(true);
    await run(async () => {
      const res = await stopSession("", "en");
      setActive(false);
      setLastResult(res);
    });
    setEnding(false);
  };

  const handleAskLive = async () => {
    const q = liveQuestion.trim();
    if (!q || asking) return;
    setAsking(true);
    await run(async () => {
      const ans = await askMeeting("", q);
      setLiveAnswer(ans);
    });
    setAsking(false);
  };

  const handleRequestCalendar = async () => {
    setRequestingCalendar(true);
    await run(async () => {
      await calendarRequestAccess();
      await loadCalendar();
    });
    setRequestingCalendar(false);
  };

  const handleProbeVideo = async () => {
    const url = videoUrl.trim();
    if (!url || probingVideo) return;
    setProbingVideo(true);
    setVideoImportNotice(null);
    await run(async () => {
      const info = await videoProbe(url);
      setVideoInfo(info);
    });
    setProbingVideo(false);
  };

  const handleImportVideo = async () => {
    const url = videoUrl.trim();
    if (!url || importingVideo) return;
    setImportingVideo(true);
    const meetingId = `meeting_import_${Date.now()}`;
    await run(async () => {
      const notice = await videoImport(meetingId, url, videoStartTime, videoEndTime);
      setVideoImportNotice(notice || "Video imported successfully into library.");
      setVideoInfo(null);
      setVideoUrl("");
    });
    setImportingVideo(false);
  };

  const inputStyle = {
    width: "100%",
    background: theme.cardBgSubtle,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    padding: "9px 12px",
    color: theme.textBody,
    fontFamily: font.ui,
    fontSize: 13.5,
    outline: "none",
    boxSizing: "border-box" as const,
  };

  const screenRecordingDenied = status !== null && !status.screen_recording;

  return (
    <div style={{ maxWidth: 840 }}>
      {error && <ActionError message={error} onDismiss={clearError} />}

      <PageTitle
        sub="Record meetings with live transcription, automated notes, and real-time query support."
      >
        Meetings
      </PageTitle>

      {/* Screen recording notice: surface mic-only state without blocking */}
      {screenRecordingDenied && (
        <Card
          pad={14}
          style={{
            marginBottom: 16,
            borderColor: theme.accentSoftBorder,
            background: theme.cardBgSubtle,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Dot ok={false} size={8} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.textStrong }}>
                Mic-only recording mode
              </div>
              <div style={{ fontSize: 12, color: theme.textMuted }}>
                Screen Recording permission is needed to capture system audio in meetings.
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void requestScreenRecording().then(() => getStatus().then(setStatus));
            }}
          >
            Grant permission
          </Button>
        </Card>
      )}

      {/* Recording Control Card */}
      <Card pad={18} style={{ marginBottom: 20 }}>
        {active ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: 9999,
                    background: palette.error,
                    boxShadow: `0 0 0 4px ${theme.accentSoft}`,
                  }}
                />
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: theme.textStrong }}>
                    Recording in progress
                  </div>
                  <div style={{ fontSize: 12, color: theme.textMuted }}>
                    Microphone {status?.screen_recording ? "and system audio active" : "active (mic-only)"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    fontFamily: font.mono,
                    fontSize: 22,
                    fontWeight: 700,
                    color: theme.accentDeep,
                    letterSpacing: 0.5,
                  }}
                >
                  {formatDuration(elapsedMs)}
                </div>
                <Button
                  variant="accent"
                  onClick={() => void handleStop()}
                  disabled={ending}
                >
                  {ending ? "Stopping..." : "End meeting"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
              Start a meeting session
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                placeholder="Meeting title (optional, e.g. Sprint Architecture Sync)"
                style={{ ...inputStyle, flex: 1 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleStart();
                  }
                }}
              />
              <Button variant="accent" onClick={() => void handleStart()}>
                <Icon name="mic" size={15} style={{ color: "#fff" }} />
                Start recording
              </Button>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: theme.textFaint }}>
              <span>Captures microphone and system audio lanes simultaneously. Hotkeys also initiate recording.</span>
              <button
                type="button"
                onClick={() => setShowVideoImport((v) => !v)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: theme.accentDeep,
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: font.ui,
                  padding: 0,
                  fontWeight: 600,
                }}
              >
                {showVideoImport ? "Hide video import" : "Import from video link"}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Video / Media Import Drawer */}
      {showVideoImport && (
        <Card pad={18} style={{ marginBottom: 20, borderColor: theme.accentSoftBorder }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
              Import Recorded Video / Audio
            </div>
            <button
              type="button"
              onClick={() => setShowVideoImport(false)}
              style={{ border: "none", background: "transparent", color: theme.textMuted, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: 12.5, color: theme.textMuted, marginBottom: 12 }}>
            Probe and import lecture videos, remote recordings, or media URLs directly into your library.
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: videoInfo ? 12 : 0 }}>
            <input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="Paste video URL or local file path (e.g. https://... or /path/to/video.mp4)"
              style={{ ...inputStyle, flex: 1 }}
            />
            <Button
              variant="dark"
              onClick={() => void handleProbeVideo()}
              disabled={probingVideo || !videoUrl.trim()}
            >
              {probingVideo ? "Probing..." : "Probe media"}
            </Button>
          </div>

          {videoInfo && (
            <div
              style={{
                marginTop: 12,
                padding: "12px 14px",
                background: theme.cardBgSubtle,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>
                Detected: {videoInfo.title}
              </div>
              <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 10 }}>
                Duration: {formatDuration(videoInfo.duration_secs * 1000)}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <label style={{ fontSize: 12, color: theme.textMuted }}>Start:</label>
                <input
                  value={videoStartTime}
                  onChange={(e) => setVideoStartTime(e.target.value)}
                  style={{ ...inputStyle, width: 80, padding: "4px 8px", fontSize: 12 }}
                />
                <label style={{ fontSize: 12, color: theme.textMuted }}>End:</label>
                <input
                  value={videoEndTime}
                  onChange={(e) => setVideoEndTime(e.target.value)}
                  style={{ ...inputStyle, width: 80, padding: "4px 8px", fontSize: 12 }}
                />
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => void handleImportVideo()}
                  disabled={importingVideo}
                >
                  {importingVideo ? "Importing..." : "Import segment"}
                </Button>
              </div>
            </div>
          )}

          {videoImportNotice && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: palette.success, fontWeight: 600 }}>
              {videoImportNotice}
            </div>
          )}
        </Card>
      )}

      {/* Upcoming Calendar Events Card */}
      {!active && (
        <Card pad={18} style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
              Upcoming Calendar Meetings
            </div>
            {calendarFeed?.authorized && (
              <Button size="sm" variant="ghost" onClick={() => void loadCalendar()}>
                Refresh
              </Button>
            )}
          </div>

          {calendarFeed === null ? (
            <div style={{ fontSize: 13, color: theme.textMuted, padding: "8px 0" }}>
              Checking calendar status...
            </div>
          ) : !calendarFeed.authorized ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                background: theme.cardBgSubtle,
                borderRadius: 8,
                border: `1px solid ${theme.border}`,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: theme.textStrong }}>
                  {calendarFeed.denied ? "Calendar access denied" : "Connect Apple Calendar"}
                </div>
                <div style={{ fontSize: 12, color: theme.textMuted }}>
                  {calendarFeed.denied
                    ? "Calendar permission was denied. You can re-enable it in macOS System Settings."
                    : "Authorize calendar access to see scheduled meetings and record with one click."}
                </div>
              </div>

              {calendarFeed.denied ? (
                <Button size="sm" variant="ghost" onClick={() => void openCalendarSettings()}>
                  Open Settings
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => void handleRequestCalendar()}
                  disabled={requestingCalendar}
                >
                  {requestingCalendar ? "Requesting..." : "Allow Access"}
                </Button>
              )}
            </div>
          ) : calendarFeed.events.length === 0 ? (
            <div style={{ fontSize: 13, color: theme.textMuted, padding: "8px 0" }}>
              No upcoming events found on your calendar for the next 7 days.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {calendarFeed.events.slice(0, 4).map((event: CalendarEvent) => (
                <div
                  key={event.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    background: theme.cardBgSubtle,
                    borderRadius: 8,
                    border: `1px solid ${theme.border}`,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textStrong }}>
                      {event.summary}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                      <span>{formatEventTime(event.start)}</span>
                      {event.calendar && <span>• {event.calendar}</span>}
                      {event.location && <span>• {event.location}</span>}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleStart(event.summary)}
                  >
                    Record
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Completed meeting result alert */}
      {lastResult && !active && (
        <Card
          pad={16}
          style={{
            marginBottom: 20,
            background: theme.cardBgSubtle,
            borderColor: theme.accentSoftBorder,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Dot ok={true} size={8} />
              <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textStrong }}>
                Meeting finished and saved
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLastResult(null)}
              style={{
                border: "none",
                background: "transparent",
                color: theme.textMuted,
                cursor: "pointer",
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: 12.5, color: theme.textMuted, marginBottom: 8 }}>
            Transcript path: {lastResult.transcript_path}
          </div>
          {lastResult.text && (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: theme.textBody,
                background: theme.cardBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                padding: "8px 12px",
                maxHeight: 120,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {lastResult.text}
            </div>
          )}
        </Card>
      )}

      {/* Live Transcript Card */}
      <Card pad={18} style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
              Live transcript
            </span>
            <span
              style={{
                fontSize: 11.5,
                padding: "2px 7px",
                borderRadius: 999,
                background: theme.track,
                color: theme.textMuted,
                fontWeight: 600,
              }}
            >
              {liveLines.length} {liveLines.length === 1 ? "line" : "lines"}
            </span>
          </div>
          {active && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: palette.success }}>
              <Dot ok={true} size={7} />
              Listening
            </div>
          )}
        </div>

        <div
          style={{
            minHeight: 260,
            maxHeight: 400,
            overflowY: "auto",
            background: theme.cardBgSubtle,
            border: `1px solid ${theme.border}`,
            borderRadius: 10,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {liveLines.length === 0 ? (
            <div
              style={{
                margin: "auto",
                textAlign: "center",
                color: theme.textMuted,
                fontSize: 13,
                padding: 24,
              }}
            >
              {active
                ? "Listening for speech... spoken words will stream here in real time."
                : "No live transcript lines. Start a session to stream transcription."}
            </div>
          ) : (
            liveLines.map((line, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  gap: 10,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                }}
              >
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 11.5,
                    color: theme.textFaint,
                    flex: "0 0 44px",
                    paddingTop: 2,
                  }}
                >
                  {formatTimestamp(line.at_ms)}
                </span>
                <span style={{ color: theme.textBody, flex: 1 }}>{line.text}</span>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </Card>

      {/* Live Question / Ask Meeting Box */}
      <Card pad={18}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginBottom: 8 }}>
          Ask about this session
        </div>
        <div style={{ fontSize: 12.5, color: theme.textMuted, marginBottom: 12 }}>
          Inquire about discussions, decisions, or commitments made during the session.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: liveAnswer ? 12 : 0 }}>
          <input
            value={liveQuestion}
            onChange={(e) => setLiveQuestion(e.target.value)}
            placeholder="What was decided about the roadmap?"
            style={{ ...inputStyle, flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAskLive();
              }
            }}
          />
          <Button
            variant="dark"
            onClick={() => void handleAskLive()}
            disabled={asking || !liveQuestion.trim()}
          >
            {asking ? "Thinking..." : "Ask"}
          </Button>
        </div>

        {liveAnswer && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 14px",
              background: theme.cardBgSubtle,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.55,
              color: theme.textBody,
              whiteSpace: "pre-wrap",
            }}
          >
            <div style={{ fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>
              Answer
            </div>
            {liveAnswer}
          </div>
        )}
      </Card>
    </div>
  );
}

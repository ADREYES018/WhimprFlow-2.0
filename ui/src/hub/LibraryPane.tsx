import { useEffect, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card, Dot, PageTitle, Segmented } from "./ui";
import { ActionError, useAction } from "./useAction";
import { Icon } from "./icons";
import {
  listMeetings,
  searchMeetings,
  deleteMeeting,
  renameMeeting,
  exportMeeting,
  getMeetingSegments,
  getMeetingTypedNotes,
  writeNotes,
  saveNotes,
  askMeeting,
  askLibrary,
  draftFollowup,
  moveMeetingToFolder,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  finishMeeting,
  type Meeting,
  type Folder,
  type TranscriptLine,
  type Template,
  type LibraryAnswer,
} from "./api";

function formatDurationSecs(secs: number): string {
  if (secs <= 0) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type DetailTab = "transcript" | "notes";

const TEMPLATE_OPTIONS: { value: Template; label: string }[] = [
  { value: "general", label: "General" },
  { value: "standup", label: "Standup" },
  { value: "one_on_one", label: "1:1 Sync" },
  { value: "interview", label: "Interview" },
  { value: "lecture", label: "Lecture" },
];

export function LibraryPane() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>("__all__");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  // Detail view tabs
  const [detailTab, setDetailTab] = useState<DetailTab>("transcript");

  // Transcript state for detail view
  const [segments, setSegments] = useState<TranscriptLine[]>([]);
  const [loadingSegments, setLoadingSegments] = useState(false);

  // Notes state for detail view
  const [notesText, setNotesText] = useState("");
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [generatingNotes, setGeneratingNotes] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template>("general");
  const [notesSaveNotice, setNotesSaveNotice] = useState<string | null>(null);
  const [followupText, setFollowupText] = useState<string | null>(null);
  const [draftingFollowup, setDraftingFollowup] = useState(false);
  const [meetingQuestion, setMeetingQuestion] = useState("");
  const [meetingAnswer, setMeetingAnswer] = useState<string | null>(null);
  const [askingMeeting, setAskingMeeting] = useState(false);

  // Ask Library state
  const [showAskLibrary, setShowAskLibrary] = useState(false);
  const [libraryQuestion, setLibraryQuestion] = useState("");
  const [libraryAnswer, setLibraryAnswer] = useState<LibraryAnswer | null>(null);
  const [askingLibrary, setAskingLibrary] = useState(false);

  // Folder creation / renaming
  const [newFolderName, setNewFolderName] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editFolderValue, setEditFolderValue] = useState("");

  // Meeting renaming
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [editMeetingTitle, setEditMeetingTitle] = useState("");

  // Export notification
  const [exportedNotice, setExportedNotice] = useState<string | null>(null);

  const { error, clearError, run } = useAction();

  const loadAll = async () => {
    await run(async () => {
      const [mList, fList] = await Promise.all([
        searchQuery.trim() ? searchMeetings(searchQuery.trim()) : listMeetings(),
        listFolders(),
      ]);
      setMeetings(mList);
      setFolders(fList);
    });
  };

  useEffect(() => {
    void loadAll();
  }, [searchQuery]);

  // Load transcript segments and notes when selected meeting changes
  useEffect(() => {
    if (!selectedMeetingId) {
      setSegments([]);
      setNotesText("");
      setFollowupText(null);
      setMeetingAnswer(null);
      return;
    }

    setLoadingSegments(true);
    setLoadingNotes(true);

    const m = meetings.find((item) => item.id === selectedMeetingId);
    if (m) setSelectedTemplate(m.template);

    run(async () => {
      const [segs, notes] = await Promise.all([
        getMeetingSegments(selectedMeetingId),
        getMeetingTypedNotes(selectedMeetingId),
      ]);
      setSegments(segs);
      setNotesText(notes ?? "");
    }).finally(() => {
      setLoadingSegments(false);
      setLoadingNotes(false);
    });
  }, [selectedMeetingId]);

  const selectedMeeting = meetings.find((m) => m.id === selectedMeetingId);

  // Folder actions
  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const ok = await run(() => createFolder(name));
    if (ok) {
      setNewFolderName("");
      setAddingFolder(false);
      await loadAll();
    }
  };

  const handleRenameFolder = async (oldName: string) => {
    const newName = editFolderValue.trim();
    if (!newName || newName === oldName) {
      setEditingFolder(null);
      return;
    }
    const ok = await run(() => renameFolder(oldName, newName));
    if (ok) {
      if (selectedFolder === oldName) setSelectedFolder(newName);
      setEditingFolder(null);
      await loadAll();
    }
  };

  const handleDeleteFolder = async (name: string) => {
    const ok = await run(() => deleteFolder(name));
    if (ok) {
      if (selectedFolder === name) setSelectedFolder("__all__");
      await loadAll();
    }
  };

  // Meeting actions
  const handleRenameMeeting = async (id: string) => {
    const title = editMeetingTitle.trim();
    if (!title) return;
    const ok = await run(() => renameMeeting(id, title));
    if (ok) {
      setEditingMeetingId(null);
      await loadAll();
    }
  };

  const handleDeleteMeeting = async (id: string) => {
    const ok = await run(() => deleteMeeting(id));
    if (ok) {
      if (selectedMeetingId === id) setSelectedMeetingId(null);
      await loadAll();
    }
  };

  const handleExportMeeting = async (id: string) => {
    setExportedNotice(null);
    await run(async () => {
      const path = await exportMeeting(id);
      setExportedNotice(`Exported meeting to: ${path}`);
    });
  };

  const handleMoveMeeting = async (id: string, folder: string | null) => {
    const ok = await run(() => moveMeetingToFolder(id, folder));
    if (ok) await loadAll();
  };

  const handleFinishTranscription = async (id: string) => {
    await run(async () => {
      await finishMeeting(id, "", "en");
      await loadAll();
      if (selectedMeetingId === id) {
        const segs = await getMeetingSegments(id);
        setSegments(segs);
      }
    });
  };

  // Notes actions
  const handleGenerateNotes = async (force: boolean) => {
    if (!selectedMeeting || generatingNotes) return;
    setGeneratingNotes(true);
    setNotesSaveNotice(null);
    await run(async () => {
      const generated = await writeNotes(selectedMeeting.id, selectedTemplate, force);
      setNotesText(generated);
      await loadAll();
    });
    setGeneratingNotes(false);
  };

  const handleSaveNotes = async () => {
    if (!selectedMeeting || savingNotes) return;
    setSavingNotes(true);
    setNotesSaveNotice(null);
    await run(async () => {
      await saveNotes(selectedMeeting.title, notesText);
      setNotesSaveNotice("Notes saved.");
      await loadAll();
    });
    setSavingNotes(false);
  };

  const handleAskMeeting = async () => {
    const q = meetingQuestion.trim();
    if (!q || askingMeeting || !selectedMeeting) return;
    setAskingMeeting(true);
    await run(async () => {
      const ans = await askMeeting(selectedMeeting.id, q);
      setMeetingAnswer(ans);
    });
    setAskingMeeting(false);
  };

  const handleDraftFollowup = async () => {
    if (!selectedMeeting || draftingFollowup) return;
    setDraftingFollowup(true);
    await run(async () => {
      const draft = await draftFollowup(selectedMeeting.id);
      setFollowupText(draft);
    });
    setDraftingFollowup(false);
  };

  // Ask Library action
  const handleAskLibrary = async () => {
    const q = libraryQuestion.trim();
    if (!q || askingLibrary) return;
    setAskingLibrary(true);
    await run(async () => {
      const ans = await askLibrary(q);
      setLibraryAnswer(ans);
    });
    setAskingLibrary(false);
  };

  // Filter meetings by selected folder
  const filteredMeetings = meetings.filter((m) => {
    if (selectedFolder === "__all__") return true;
    if (selectedFolder === "__uncategorized__") return m.folder === null;
    return m.folder === selectedFolder;
  });

  const inputStyle = {
    background: theme.cardBgSubtle,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    padding: "6px 10px",
    color: theme.textBody,
    fontFamily: font.ui,
    fontSize: 13,
    outline: "none",
  };

  return (
    <div style={{ maxWidth: 1040 }}>
      {error && <ActionError message={error} onDismiss={clearError} />}

      {exportedNotice && (
        <Card
          pad={12}
          style={{
            marginBottom: 16,
            borderColor: theme.accentSoftBorder,
            background: theme.cardBgSubtle,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 13, color: theme.textStrong }}>{exportedNotice}</div>
          <button
            type="button"
            onClick={() => setExportedNotice(null)}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: theme.textMuted,
              padding: 4,
            }}
          >
            ✕
          </button>
        </Card>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <PageTitle sub="Browse past recordings, inspect transcripts, organize into folders, and query notes.">
          Meeting Library
        </PageTitle>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button
            size="sm"
            variant={showAskLibrary ? "accent" : "ghost"}
            onClick={() => setShowAskLibrary((v) => !v)}
          >
            Ask the Library
          </Button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: 9,
              padding: "6px 10px",
              minWidth: 240,
            }}
          >
            <Icon name="search" size={15} style={{ color: theme.textFaint }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search meetings by title..."
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                fontFamily: font.ui,
                fontSize: 13,
                color: theme.textBody,
                width: "100%",
              }}
            />
          </div>
        </div>
      </div>

      {/* Ask the Library Drawer */}
      {showAskLibrary && (
        <Card pad={18} style={{ marginBottom: 20, borderColor: theme.accentSoftBorder }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
              Ask the Library (Cross-Meeting Query)
            </div>
            <button
              type="button"
              onClick={() => setShowAskLibrary(false)}
              style={{
                border: "none",
                background: "transparent",
                color: theme.textMuted,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: 12.5, color: theme.textMuted, marginBottom: 12 }}>
            Search for decisions, discussions, or topics across all recorded transcripts in your library.
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: libraryAnswer ? 12 : 0 }}>
            <input
              value={libraryQuestion}
              onChange={(e) => setLibraryQuestion(e.target.value)}
              placeholder="e.g. When did we discuss onboarding and what was decided?"
              style={{ ...inputStyle, flex: 1, padding: "8px 12px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAskLibrary();
                }
              }}
            />
            <Button
              variant="dark"
              onClick={() => void handleAskLibrary()}
              disabled={askingLibrary || !libraryQuestion.trim()}
            >
              {askingLibrary ? "Searching..." : "Search Library"}
            </Button>
          </div>

          {libraryAnswer && (
            <div
              style={{
                marginTop: 14,
                padding: "12px 14px",
                background: theme.cardBgSubtle,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 13, lineHeight: 1.6, color: theme.textBody, whiteSpace: "pre-wrap", marginBottom: 12 }}>
                {libraryAnswer.answer}
              </div>

              {libraryAnswer.sources.length > 0 && (
                <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: theme.textMuted, marginBottom: 6 }}>
                    Sources Referenced:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {libraryAnswer.sources.map((src) => (
                      <button
                        key={src.id}
                        type="button"
                        onClick={() => {
                          setSelectedMeetingId(src.id);
                          setShowAskLibrary(false);
                        }}
                        style={{
                          border: `1px solid ${theme.border}`,
                          background: theme.cardBg,
                          borderRadius: 6,
                          padding: "4px 8px",
                          fontSize: 12,
                          color: theme.accentDeep,
                          cursor: "pointer",
                          fontFamily: font.ui,
                          fontWeight: 500,
                        }}
                      >
                        {src.title} ({formatDate(src.started_at)})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Main Library Layout: Folder sidebar + List or Detail view */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
        {/* Left: Folders Sidebar */}
        <div>
          <Card pad={14} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "2px 4px 8px",
                borderBottom: `1px solid ${theme.border}`,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: theme.textMuted, letterSpacing: 0.5 }}>
                Folders
              </span>
              <button
                type="button"
                onClick={() => setAddingFolder((v) => !v)}
                title="Add folder"
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: theme.accentDeep,
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Icon name="plus" size={15} />
              </button>
            </div>

            {addingFolder && (
              <div style={{ padding: "6px 0", display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="New folder name"
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateFolder();
                    if (e.key === "Escape") setAddingFolder(false);
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <Button size="sm" variant="accent" onClick={() => void handleCreateFolder()}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAddingFolder(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Folder list items */}
            <button
              type="button"
              onClick={() => {
                setSelectedFolder("__all__");
                setSelectedMeetingId(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "7px 10px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontFamily: font.ui,
                fontSize: 13,
                fontWeight: selectedFolder === "__all__" ? 600 : 500,
                color: selectedFolder === "__all__" ? theme.accentDeep : theme.textBody,
                background: selectedFolder === "__all__" ? theme.accentSoft : "transparent",
                textAlign: "left",
              }}
            >
              <span>All Meetings</span>
              <span style={{ fontSize: 11.5, color: theme.textMuted }}>{meetings.length}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedFolder("__uncategorized__");
                setSelectedMeetingId(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "7px 10px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontFamily: font.ui,
                fontSize: 13,
                fontWeight: selectedFolder === "__uncategorized__" ? 600 : 500,
                color: selectedFolder === "__uncategorized__" ? theme.accentDeep : theme.textBody,
                background: selectedFolder === "__uncategorized__" ? theme.accentSoft : "transparent",
                textAlign: "left",
              }}
            >
              <span>Uncategorized</span>
              <span style={{ fontSize: 11.5, color: theme.textMuted }}>
                {meetings.filter((m) => m.folder === null).length}
              </span>
            </button>

            {folders.map((f) => (
              <div key={f.name}>
                {editingFolder === f.name ? (
                  <div style={{ padding: "4px 0", display: "flex", gap: 4 }}>
                    <input
                      autoFocus
                      value={editFolderValue}
                      onChange={(e) => setEditFolderValue(e.target.value)}
                      style={{ ...inputStyle, flex: 1, fontSize: 12 }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRenameFolder(f.name);
                        if (e.key === "Escape") setEditingFolder(null);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleRenameFolder(f.name)}
                      style={{
                        border: "none",
                        background: theme.accentDeep,
                        color: "#fff",
                        borderRadius: 6,
                        padding: "3px 6px",
                        cursor: "pointer",
                      }}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingFolder(null)}
                      style={{
                        border: "none",
                        background: theme.track,
                        color: theme.textMuted,
                        borderRadius: 6,
                        padding: "3px 6px",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "7px 10px",
                      borderRadius: 8,
                      background: selectedFolder === f.name ? theme.accentSoft : "transparent",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFolder(f.name);
                        setSelectedMeetingId(null);
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        fontFamily: font.ui,
                        fontSize: 13,
                        fontWeight: selectedFolder === f.name ? 600 : 500,
                        color: selectedFolder === f.name ? theme.accentDeep : theme.textBody,
                        textAlign: "left",
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        padding: 0,
                      }}
                    >
                      {f.name}
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 11.5, color: theme.textMuted }}>{f.count}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingFolder(f.name);
                          setEditFolderValue(f.name);
                        }}
                        style={{
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: theme.textFaint,
                          padding: 2,
                        }}
                        title="Rename folder"
                      >
                        <Icon name="edit" size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteFolder(f.name)}
                        style={{
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: theme.textFaint,
                          padding: 2,
                        }}
                        title="Delete folder"
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </Card>
        </div>

        {/* Right: Meeting List or Detail View */}
        <div>
          {selectedMeeting ? (
            /* Meeting Detail View */
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Header card with breadcrumb & actions */}
              <Card pad={18}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedMeetingId(null)}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontFamily: font.ui,
                      fontSize: 13,
                      fontWeight: 600,
                      color: theme.accentDeep,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: 0,
                    }}
                  >
                    ← Back to meetings
                  </button>

                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="sm" variant="ghost" onClick={() => void handleExportMeeting(selectedMeeting.id)}>
                      Export meeting
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void handleDeleteMeeting(selectedMeeting.id)}>
                      Delete
                    </Button>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {editingMeetingId === selectedMeeting.id ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          autoFocus
                          value={editMeetingTitle}
                          onChange={(e) => setEditMeetingTitle(e.target.value)}
                          style={{ ...inputStyle, fontSize: 16, fontWeight: 600, flex: 1 }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleRenameMeeting(selectedMeeting.id);
                            if (e.key === "Escape") setEditingMeetingId(null);
                          }}
                        />
                        <Button size="sm" variant="accent" onClick={() => void handleRenameMeeting(selectedMeeting.id)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingMeetingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <h2
                          style={{
                            margin: 0,
                            fontSize: 20,
                            fontWeight: 600,
                            color: theme.textStrong,
                            fontFamily: font.serif,
                          }}
                        >
                          {selectedMeeting.title}
                        </h2>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMeetingId(selectedMeeting.id);
                            setEditMeetingTitle(selectedMeeting.title);
                          }}
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: theme.textMuted,
                            padding: 3,
                          }}
                          title="Rename meeting"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                      </div>
                    )}

                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 8 }}>
                      <span style={{ fontSize: 12, color: theme.textMuted }}>
                        Started: {formatDate(selectedMeeting.started_at)}
                      </span>
                      <span style={{ fontSize: 12, color: theme.textMuted }}>
                        Duration: {formatDurationSecs(selectedMeeting.duration_secs)}
                      </span>
                      <span
                        style={{
                          fontSize: 11.5,
                          padding: "2px 7px",
                          borderRadius: 4,
                          background: theme.track,
                          color: theme.textMuted,
                        }}
                      >
                        Template: {selectedMeeting.template}
                      </span>
                      <select
                        value={selectedMeeting.folder ?? ""}
                        onChange={(e) => void handleMoveMeeting(selectedMeeting.id, e.target.value ? e.target.value : null)}
                        style={{
                          ...inputStyle,
                          padding: "3px 8px",
                          fontSize: 11.5,
                          cursor: "pointer",
                        }}
                      >
                        <option value="">No folder</option>
                        {folders.map((f) => (
                          <option key={f.name} value={f.name}>
                            Folder: {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* View switcher tabs */}
                <div style={{ marginTop: 16 }}>
                  <Segmented<DetailTab>
                    options={[
                      { value: "transcript", label: "Transcript" },
                      { value: "notes", label: "Notes & Query" },
                    ]}
                    value={detailTab}
                    onChange={setDetailTab}
                  />
                </div>
              </Card>

              {/* Honest transcription status indicator */}
              {!selectedMeeting.transcribed && (
                <Card
                  pad={14}
                  style={{
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
                        Transcription in progress or pending
                      </div>
                      <div style={{ fontSize: 12, color: theme.textMuted }}>
                        {selectedMeeting.pending_segments.length > 0
                          ? `Pending audio segments: ${selectedMeeting.pending_segments.join(", ")}`
                          : "Audio is recorded, awaiting transcription processing."}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => void handleFinishTranscription(selectedMeeting.id)}
                  >
                    Finish transcription
                  </Button>
                </Card>
              )}

              {/* Tab 1: Transcript View */}
              {detailTab === "transcript" && (
                <Card pad={18}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginBottom: 12 }}>
                    Meeting Transcript
                  </div>

                  {loadingSegments ? (
                    <div style={{ padding: 24, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
                      Loading transcript segments...
                    </div>
                  ) : segments.length === 0 ? (
                    <div style={{ padding: 32, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
                      {selectedMeeting.transcribed
                        ? "No transcript lines found for this meeting."
                        : "Transcript is not available yet. Complete transcription to view segments."}
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        maxHeight: 480,
                        overflowY: "auto",
                        paddingRight: 6,
                      }}
                    >
                      {segments.map((seg, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            gap: 12,
                            fontSize: 13.5,
                            lineHeight: 1.55,
                            padding: "6px 0",
                            borderBottom: idx < segments.length - 1 ? `1px solid ${theme.border}` : "none",
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
                            {seg.at}
                          </span>
                          <div style={{ flex: 1 }}>
                            {seg.speaker && (
                              <span style={{ fontWeight: 600, color: theme.textStrong, marginRight: 6 }}>
                                {seg.speaker}:
                              </span>
                            )}
                            <span style={{ color: theme.textBody }}>{seg.text}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* Tab 2: Notes & Query View */}
              {detailTab === "notes" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* Stale notes warning banner */}
                  {selectedMeeting.notes_stale && (
                    <Card
                      pad={14}
                      style={{
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
                            Notes may be outdated
                          </div>
                          <div style={{ fontSize: 12, color: theme.textMuted }}>
                            The transcript was modified after these notes were compiled.
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="accent"
                        onClick={() => void handleGenerateNotes(true)}
                        disabled={generatingNotes}
                      >
                        {generatingNotes ? "Regenerating..." : "Regenerate notes"}
                      </Button>
                    </Card>
                  )}

                  {/* Notes generation controls card */}
                  <Card pad={18}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
                          Automated Notes
                        </div>
                        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                          Generate structured meeting notes with your chosen template.
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDraftFollowup()}
                          disabled={draftingFollowup || !selectedMeeting.has_notes}
                        >
                          {draftingFollowup ? "Drafting email..." : "Draft follow-up"}
                        </Button>
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => void handleGenerateNotes(selectedMeeting.notes_stale)}
                          disabled={generatingNotes}
                        >
                          {generatingNotes
                            ? "Generating..."
                            : selectedMeeting.has_notes
                              ? "Regenerate notes"
                              : "Generate notes"}
                        </Button>
                      </div>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 6 }}>
                        Note template
                      </label>
                      <Segmented<Template>
                        options={TEMPLATE_OPTIONS}
                        value={selectedTemplate}
                        onChange={setSelectedTemplate}
                      />
                    </div>

                    {/* Follow-up email draft display if requested */}
                    {followupText && (
                      <div
                        style={{
                          marginBottom: 14,
                          padding: "12px 14px",
                          background: theme.cardBgSubtle,
                          border: `1px solid ${theme.border}`,
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: theme.textStrong }}>
                            Draft Follow-up Email
                          </div>
                          <button
                            type="button"
                            onClick={() => setFollowupText(null)}
                            style={{ border: "none", background: "transparent", color: theme.textMuted, cursor: "pointer" }}
                          >
                            ✕
                          </button>
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            lineHeight: 1.5,
                            color: theme.textBody,
                            whiteSpace: "pre-wrap",
                            background: theme.cardBg,
                            padding: "8px 12px",
                            borderRadius: 6,
                            border: `1px solid ${theme.border}`,
                          }}
                        >
                          {followupText}
                        </div>
                      </div>
                    )}

                    {/* Notes Editor Textarea */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <label style={{ fontSize: 12, color: theme.textMuted }}>
                          Notes editor (Markdown)
                        </label>
                        {notesSaveNotice && (
                          <span style={{ fontSize: 12, color: palette.success, fontWeight: 600 }}>
                            {notesSaveNotice}
                          </span>
                        )}
                      </div>

                      {loadingNotes ? (
                        <div style={{ padding: 24, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
                          Loading notes...
                        </div>
                      ) : (
                        <textarea
                          rows={12}
                          value={notesText}
                          onChange={(e) => {
                            setNotesText(e.target.value);
                            setNotesSaveNotice(null);
                          }}
                          placeholder={
                            selectedMeeting.has_notes
                              ? "Notes content..."
                              : "No notes compiled yet. Select a template and click 'Generate notes'."
                          }
                          style={{
                            ...inputStyle,
                            width: "100%",
                            resize: "vertical",
                            lineHeight: 1.6,
                            fontFamily: font.mono,
                            fontSize: 13,
                            boxSizing: "border-box",
                          }}
                        />
                      )}

                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                        <Button
                          size="sm"
                          variant="dark"
                          onClick={() => void handleSaveNotes()}
                          disabled={savingNotes || !notesText.trim()}
                        >
                          {savingNotes ? "Saving..." : "Save changes"}
                        </Button>
                      </div>
                    </div>
                  </Card>

                  {/* Ask This Meeting Card */}
                  <Card pad={18}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>
                      Ask This Meeting
                    </div>
                    <div style={{ fontSize: 12.5, color: theme.textMuted, marginBottom: 12 }}>
                      Query specific details from this meeting transcript.
                    </div>

                    <div style={{ display: "flex", gap: 8, marginBottom: meetingAnswer ? 12 : 0 }}>
                      <input
                        value={meetingQuestion}
                        onChange={(e) => setMeetingQuestion(e.target.value)}
                        placeholder="e.g. What were the next action items assigned to engineering?"
                        style={{ ...inputStyle, flex: 1, padding: "8px 12px" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleAskMeeting();
                          }
                        }}
                      />
                      <Button
                        variant="dark"
                        onClick={() => void handleAskMeeting()}
                        disabled={askingMeeting || !meetingQuestion.trim()}
                      >
                        {askingMeeting ? "Thinking..." : "Ask"}
                      </Button>
                    </div>

                    {meetingAnswer && (
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
                        {meetingAnswer}
                      </div>
                    )}
                  </Card>
                </div>
              )}
            </div>
          ) : (
            /* Meeting List View */
            <Card pad={filteredMeetings.length ? 8 : 24}>
              {filteredMeetings.length === 0 ? (
                <div
                  style={{
                    padding: "36px 16px",
                    textAlign: "center",
                    color: theme.textMuted,
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    maxWidth: 420,
                    margin: "0 auto",
                  }}
                >
                  <div style={{ fontWeight: 600, color: theme.textStrong, marginBottom: 4 }}>
                    No meetings found
                  </div>
                  <div>
                    {searchQuery
                      ? `No meetings match “${searchQuery}”.`
                      : "Record a session in the Meetings tab to start building your library."}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {filteredMeetings.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "14px 12px",
                        borderBottom: `1px solid ${theme.border}`,
                        cursor: "pointer",
                        transition: "background 120ms ease",
                      }}
                      onClick={() => setSelectedMeetingId(m.id)}
                    >
                      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14.5, fontWeight: 600, color: theme.textStrong }}>
                            {m.title}
                          </span>
                          {!m.transcribed && (
                            <span
                              style={{
                                fontSize: 11,
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: palette.error,
                                color: "#fff",
                                fontWeight: 600,
                              }}
                            >
                              Transcribing
                            </span>
                          )}
                          {m.folder && (
                            <span
                              style={{
                                fontSize: 11,
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: theme.track,
                                color: theme.textMuted,
                              }}
                            >
                              {m.folder}
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: theme.textMuted }}>
                          <span>{formatDate(m.started_at)}</span>
                          <span>•</span>
                          <span>{formatDurationSecs(m.duration_secs)}</span>
                          <span>•</span>
                          <span>Template: {m.template}</span>
                          {m.has_notes && (
                            <>
                              <span>•</span>
                              <span style={{ color: theme.accentDeep, fontWeight: 600 }}>Notes ready</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" onClick={() => void handleExportMeeting(m.id)}>
                          Export
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void handleDeleteMeeting(m.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card, Dot, PageTitle, Segmented } from "./ui";
import { ActionError, useAction } from "./useAction";
import { Icon } from "./icons";
import { OatmealAskBar, type QAItem } from "./OatmealAskBar";
import { formatDate } from "./format";
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
  generateStudyPlan,
  cachedStudyPlan,
  generateFlashcards,
  cachedFlashcards,
  generateQuiz,
  cachedQuiz,
  lastStudySettings,
  listHomework,
  addHomework,
  setHomeworkDone,
  deleteHomework,
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
  type Difficulty,
  type StudySettings,
  type Flashcard,
  type QuizQuestion,
  type HomeworkItem,
} from "./api";

function formatDurationSecs(secs: number): string {
  if (secs <= 0) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}


type DetailTab = "transcript" | "notes" | "study" | "homework";

const TEMPLATE_OPTIONS: { value: Template; label: string }[] = [
  { value: "general", label: "General" },
  { value: "standup", label: "Standup" },
  { value: "one_on_one", label: "1:1 Sync" },
  { value: "interview", label: "Interview" },
  { value: "lecture", label: "Lecture" },
];

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
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

  // Study Hub state
  const [studySubTab, setStudySubTab] = useState<"plan" | "flashcards" | "quiz">("plan");
  const [studySettings, setStudySettings] = useState<StudySettings>({
    count: 5,
    difficulty: "medium",
    topicFocus: "",
  });
  const [studyPlan, setStudyPlan] = useState<string | null>(null);
  const [flashcards, setFlashcards] = useState<Flashcard[] | null>(null);
  const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [generatingCards, setGeneratingCards] = useState(false);
  const [generatingQuizState, setGeneratingQuizState] = useState(false);

  // Flashcards interactive state
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);

  // Quiz interactive state
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});

  // Homework state
  const [homeworkList, setHomeworkList] = useState<HomeworkItem[]>([]);
  const [newHwTitle, setNewHwTitle] = useState("");
  const [newHwDueDate, setNewHwDueDate] = useState("");
  const [addingHw, setAddingHw] = useState(false);

  // Ask Library state
  const [showAskLibrary, setShowAskLibrary] = useState(false);
  const [meetingQAHistory, setMeetingQAHistory] = useState<Record<string, QAItem[]>>({});
  const [libraryQAItems, setLibraryQAItems] = useState<QAItem[]>([]);

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

  // Load meeting data when selected meeting changes
  useEffect(() => {
    if (!selectedMeetingId) {
      setSegments([]);
      setNotesText("");
      setFollowupText(null);
      setStudyPlan(null);
      setFlashcards(null);
      setQuiz(null);
      setUserAnswers({});
      setCurrentCardIndex(0);
      setIsCardFlipped(false);
      return;
    }

    setLoadingSegments(true);
    setLoadingNotes(true);

    const m = meetings.find((item) => item.id === selectedMeetingId);
    if (m) setSelectedTemplate(m.template);

    run(async () => {
      const [segs, notes, plan, cards, qz, lastSet, hw] = await Promise.all([
        getMeetingSegments(selectedMeetingId),
        getMeetingTypedNotes(selectedMeetingId),
        cachedStudyPlan(selectedMeetingId),
        cachedFlashcards(selectedMeetingId),
        cachedQuiz(selectedMeetingId),
        lastStudySettings(selectedMeetingId),
        listHomework(),
      ]);
      setSegments(segs);
      setNotesText(notes ?? "");
      setStudyPlan(plan);
      setFlashcards(cards);
      setQuiz(qz);
      if (lastSet) setStudySettings(lastSet);
      setHomeworkList(hw);
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

  const handleDraftFollowup = async () => {
    if (!selectedMeeting || draftingFollowup) return;
    setDraftingFollowup(true);
    await run(async () => {
      const draft = await draftFollowup(selectedMeeting.id);
      setFollowupText(draft);
    });
    setDraftingFollowup(false);
  };

  // Study actions (serving cache first, force parameter for re-generation)
  const handleGenerateStudyPlan = async (force: boolean) => {
    if (!selectedMeeting || generatingPlan) return;
    setGeneratingPlan(true);
    await run(async () => {
      const plan = await generateStudyPlan(selectedMeeting.id, studySettings, force);
      setStudyPlan(plan);
    });
    setGeneratingPlan(false);
  };

  const handleGenerateFlashcards = async (force: boolean) => {
    if (!selectedMeeting || generatingCards) return;
    setGeneratingCards(true);
    await run(async () => {
      const cards = await generateFlashcards(selectedMeeting.id, studySettings, force);
      setFlashcards(cards);
      setCurrentCardIndex(0);
      setIsCardFlipped(false);
    });
    setGeneratingCards(false);
  };

  const handleGenerateQuiz = async (force: boolean) => {
    if (!selectedMeeting || generatingQuizState) return;
    setGeneratingQuizState(true);
    await run(async () => {
      const qz = await generateQuiz(selectedMeeting.id, studySettings, force);
      setQuiz(qz);
      setUserAnswers({});
    });
    setGeneratingQuizState(false);
  };

  // Homework actions
  const handleAddHomework = async () => {
    const t = newHwTitle.trim();
    if (!t || !selectedMeeting) return;
    const due =
      newHwDueDate.trim() ||
      new Date(Date.now() + 86400 * 1000 * 3).toISOString().slice(0, 10);
    await run(async () => {
      const item = await addHomework(selectedMeeting.id, t, due);
      setHomeworkList((prev) => [...prev, item]);
      setNewHwTitle("");
      setNewHwDueDate("");
      setAddingHw(false);
    });
  };

  const handleToggleHomework = async (id: string, done: boolean) => {
    await run(async () => {
      await setHomeworkDone(id, done);
      setHomeworkList((prev) =>
        prev.map((item) => (item.id === id ? { ...item, done } : item))
      );
    });
  };

  const handleDeleteHomework = async (id: string) => {
    await run(async () => {
      await deleteHomework(id);
      setHomeworkList((prev) => prev.filter((item) => item.id !== id));
    });
  };

  // Uses raw try/catch instead of useAction: this is a chat-shaped Q&A feed
  // where each question needs its own error, and useAction.error is a single
  // pane-wide string that cannot carry a per-item error. The error is stored
  // on the individual QAItem instead and surfaces inline on that card.
  const handleMeetingAsk = async (question: string) => {
    if (!selectedMeeting) return;
    const meetingId = selectedMeeting.id;
    const tempId = `qa-${Date.now()}`;
    const newItem: QAItem = { id: tempId, question, answer: "", loading: true };

    setMeetingQAHistory((prev) => ({
      ...prev,
      [meetingId]: [...(prev[meetingId] ?? []), newItem],
    }));

    try {
      const answer = await askMeeting(meetingId, question);
      setMeetingQAHistory((prev) => ({
        ...prev,
        [meetingId]: (prev[meetingId] ?? []).map((q) =>
          q.id === tempId ? { ...q, answer, loading: false } : q
        ),
      }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setMeetingQAHistory((prev) => ({
        ...prev,
        [meetingId]: (prev[meetingId] ?? []).map((q) =>
          q.id === tempId ? { ...q, error: errorMsg, loading: false } : q
        ),
      }));
    }
  };

  const handleDismissMeetingQA = (id: string) => {
    if (!selectedMeeting) return;
    const meetingId = selectedMeeting.id;
    setMeetingQAHistory((prev) => ({
      ...prev,
      [meetingId]: (prev[meetingId] ?? []).filter((q) => q.id !== id),
    }));
  };

  // Same reasoning as handleMeetingAsk above: per-question errors need to
  // live on the individual QAItem, not on useAction's single pane-wide error.
  const handleGlobalLibraryAsk = async (question: string) => {
    const tempId = `global-qa-${Date.now()}`;
    const newItem: QAItem = { id: tempId, question, answer: "", loading: true };

    setLibraryQAItems((prev) => [...prev, newItem]);

    try {
      const res = await askLibrary(question);
      setLibraryQAItems((prev) =>
        prev.map((q) =>
          q.id === tempId
            ? { ...q, answer: res.answer, sources: res.sources, loading: false }
            : q
        )
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setLibraryQAItems((prev) =>
        prev.map((q) =>
          q.id === tempId ? { ...q, error: errorMsg, loading: false } : q
        )
      );
    }
  };

  const handleDismissLibraryQA = (id: string) => {
    setLibraryQAItems((prev) => prev.filter((q) => q.id !== id));
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
        <PageTitle sub="Browse past recordings, inspect transcripts, generate study materials, and organize notes.">
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
                Ask the Library (Cross-Meeting Query)
              </div>
              <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 2 }}>
                Search for decisions, discussions, or topics across all recorded transcripts in your library.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAskLibrary(false)}
              style={{
                border: "none",
                background: "transparent",
                color: theme.textMuted,
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              ✕
            </button>
          </div>

          <OatmealAskBar
            items={libraryQAItems}
            onAsk={handleGlobalLibraryAsk}
            onDismiss={handleDismissLibraryQA}
            onSelectSource={(sourceId) => {
              setSelectedMeetingId(sourceId);
              setShowAskLibrary(false);
            }}
            placeholder="Ask across all your meetings (e.g. 'what did we decide about pricing?')"
            suggestions={[
              "Decisions across all meetings",
              "Key action items pending",
              "Latest roadmap updates",
              "Recurring topics discussed",
            ]}
            stickyBottom={false}
          />
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
                      { value: "study", label: "Study Hub" },
                      { value: "homework", label: "Action Items" },
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
                </div>
              )}

              {/* Tab 3: Study Hub */}
              {detailTab === "study" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* Study Settings Form Card */}
                  <Card pad={18}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
                          Study Settings
                        </div>
                        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                          Tune the difficulty, scope, and quantity for study materials.
                        </div>
                      </div>

                      <Segmented<"plan" | "flashcards" | "quiz">
                        options={[
                          { value: "plan", label: "Study Plan" },
                          { value: "flashcards", label: "Flashcards" },
                          { value: "quiz", label: "Quiz" },
                        ]}
                        value={studySubTab}
                        onChange={setStudySubTab}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 8 }}>
                      <div>
                        <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
                          Item Count (3 - 30)
                        </label>
                        <input
                          type="number"
                          min={3}
                          max={30}
                          value={studySettings.count}
                          onChange={(e) =>
                            setStudySettings({
                              ...studySettings,
                              count: Math.min(30, Math.max(3, Number(e.target.value) || 3)),
                            })
                          }
                          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
                          Difficulty Level
                        </label>
                        <Segmented<Difficulty>
                          options={DIFFICULTY_OPTIONS}
                          value={studySettings.difficulty}
                          onChange={(diff) => setStudySettings({ ...studySettings, difficulty: diff })}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 5 }}>
                          Topic Focus <span style={{ color: theme.textFaint }}>(blank for all)</span>
                        </label>
                        <input
                          value={studySettings.topicFocus}
                          onChange={(e) =>
                            setStudySettings({ ...studySettings, topicFocus: e.target.value })
                          }
                          placeholder="e.g. key deadlines"
                          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                        />
                      </div>
                    </div>
                  </Card>

                  {/* Sub-tab: Study Plan */}
                  {studySubTab === "plan" && (
                    <Card pad={18}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
                          Comprehensive Study Plan
                        </div>
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => void handleGenerateStudyPlan(Boolean(studyPlan))}
                          disabled={generatingPlan}
                        >
                          {generatingPlan
                            ? "Generating..."
                            : studyPlan
                              ? "Regenerate study plan"
                              : "Generate study plan"}
                        </Button>
                      </div>

                      {generatingPlan ? (
                        <div style={{ padding: 28, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
                          Analyzing transcript and compiling study roadmap...
                        </div>
                      ) : studyPlan ? (
                        <div
                          style={{
                            background: theme.cardBgSubtle,
                            border: `1px solid ${theme.border}`,
                            borderRadius: 10,
                            padding: "14px 16px",
                            fontSize: 13.5,
                            lineHeight: 1.6,
                            color: theme.textBody,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {studyPlan}
                        </div>
                      ) : (
                        <div style={{ padding: 36, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
                          No study plan cached for this meeting. Click 'Generate study plan' to create one.
                        </div>
                      )}
                    </Card>
                  )}

                  {/* Sub-tab: Flashcards */}
                  {studySubTab === "flashcards" && (
                    <Card pad={18}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
                          Interactive Flashcards
                        </div>
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => void handleGenerateFlashcards(Boolean(flashcards))}
                          disabled={generatingCards}
                        >
                          {generatingCards
                            ? "Generating..."
                            : flashcards
                              ? "Regenerate cards"
                              : "Generate flashcards"}
                        </Button>
                      </div>

                      {generatingCards ? (
                        <div style={{ padding: 28, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
                          Extracting key concepts into flashcards...
                        </div>
                      ) : flashcards && flashcards.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: theme.textMuted }}>
                            <span>
                              Card {currentCardIndex + 1} of {flashcards.length}
                            </span>
                            <span style={{ fontStyle: "italic" }}>
                              {isCardFlipped ? "Answer side" : "Prompt side (click Flip to reveal)"}
                            </span>
                          </div>

                          <div
                            onClick={() => setIsCardFlipped((f) => !f)}
                            style={{
                              background: theme.cardBgSubtle,
                              border: `1px solid ${theme.accentSoftBorder}`,
                              borderRadius: 12,
                              padding: "36px 24px",
                              textAlign: "center",
                              cursor: "pointer",
                              minHeight: 140,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: theme.shadow,
                              transition: "all 150ms ease",
                            }}
                          >
                            <div style={{ fontSize: 12, color: theme.accentDeep, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>
                              {isCardFlipped ? "Answer" : "Question"}
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: theme.textStrong, lineHeight: 1.5, maxWidth: 480 }}>
                              {isCardFlipped
                                ? flashcards[currentCardIndex].back
                                : flashcards[currentCardIndex].front}
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setCurrentCardIndex((i) => Math.max(0, i - 1));
                                setIsCardFlipped(false);
                              }}
                              disabled={currentCardIndex === 0}
                            >
                              ← Previous
                            </Button>
                            <Button
                              size="sm"
                              variant="dark"
                              onClick={() => setIsCardFlipped((f) => !f)}
                            >
                              Flip Card
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setCurrentCardIndex((i) => Math.min(flashcards.length - 1, i + 1));
                                setIsCardFlipped(false);
                              }}
                              disabled={currentCardIndex === flashcards.length - 1}
                            >
                              Next →
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: 36, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
                          No flashcards cached for this meeting. Click 'Generate flashcards' to extract cards.
                        </div>
                      )}
                    </Card>
                  )}

                  {/* Sub-tab: Quiz */}
                  {studySubTab === "quiz" && (
                    <Card pad={18}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
                            Comprehension Quiz
                          </div>
                          {quiz && quiz.length > 0 && (
                            <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                              Score: {Object.entries(userAnswers).filter(([qIdx, optIdx]) => quiz[Number(qIdx)].correct_index === optIdx).length} / {quiz.length} answered correctly
                            </div>
                          )}
                        </div>

                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => void handleGenerateQuiz(Boolean(quiz))}
                          disabled={generatingQuizState}
                        >
                          {generatingQuizState
                            ? "Generating..."
                            : quiz
                              ? "Regenerate quiz"
                              : "Generate quiz"}
                        </Button>
                      </div>

                      {generatingQuizState ? (
                        <div style={{ padding: 28, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
                          Formulating comprehension quiz questions...
                        </div>
                      ) : quiz && quiz.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                          {quiz.map((q, qIdx) => {
                            const selectedOption = userAnswers[qIdx];
                            const isAnswered = selectedOption !== undefined;
                            return (
                              <div
                                key={qIdx}
                                style={{
                                  background: theme.cardBgSubtle,
                                  border: `1px solid ${theme.border}`,
                                  borderRadius: 10,
                                  padding: "14px 16px",
                                }}
                              >
                                <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginBottom: 10 }}>
                                  {qIdx + 1}. {q.question}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {q.options.map((opt, optIdx) => {
                                    const isSelected = selectedOption === optIdx;
                                    const isCorrect = q.correct_index === optIdx;
                                    let optionBg: string = theme.cardBg;
                                    let optionBorder: string = theme.border;

                                    if (isAnswered) {
                                      if (isCorrect) {
                                        optionBg = "rgba(74, 222, 128, 0.12)";
                                        optionBorder = palette.success;
                                      } else if (isSelected) {
                                        optionBg = "rgba(248, 113, 113, 0.12)";
                                        optionBorder = palette.error;
                                      }
                                    }

                                    return (
                                      <button
                                        key={optIdx}
                                        type="button"
                                        onClick={() => {
                                          if (!isAnswered) {
                                            setUserAnswers({ ...userAnswers, [qIdx]: optIdx });
                                          }
                                        }}
                                        style={{
                                          textAlign: "left",
                                          padding: "8px 12px",
                                          borderRadius: 8,
                                          background: optionBg,
                                          border: `1px solid ${optionBorder}`,
                                          cursor: isAnswered ? "default" : "pointer",
                                          fontFamily: font.ui,
                                          fontSize: 13,
                                          color: theme.textBody,
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                        }}
                                      >
                                        <span>{opt}</span>
                                        {isAnswered && isCorrect && (
                                          <span style={{ color: palette.success, fontWeight: 600, fontSize: 12 }}>
                                            ✓ Correct
                                          </span>
                                        )}
                                        {isAnswered && isSelected && !isCorrect && (
                                          <span style={{ color: palette.error, fontWeight: 600, fontSize: 12 }}>
                                            ✕ Incorrect
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ padding: 36, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
                          No quiz cached for this meeting. Click 'Generate quiz' to test retention.
                        </div>
                      )}
                    </Card>
                  )}
                </div>
              )}

              {/* Tab 4: Homework & Action Items */}
              {detailTab === "homework" && (
                <Card pad={18}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
                        Action Items & Homework
                      </div>
                      <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                        Track assigned tasks and deliverables resulting from this session.
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="accent"
                      onClick={() => setAddingHw((v) => !v)}
                    >
                      <Icon name="plus" size={14} style={{ color: "#fff" }} />
                      Add action item
                    </Button>
                  </div>

                  {addingHw && (
                    <div
                      style={{
                        marginBottom: 16,
                        padding: 12,
                        background: theme.cardBgSubtle,
                        border: `1px solid ${theme.accentSoftBorder}`,
                        borderRadius: 8,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <input
                        autoFocus
                        value={newHwTitle}
                        onChange={(e) => setNewHwTitle(e.target.value)}
                        placeholder="Action item description (e.g. Submit draft proposal)"
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                      />
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <label style={{ fontSize: 12, color: theme.textMuted }}>Due Date:</label>
                        <input
                          type="date"
                          value={newHwDueDate}
                          onChange={(e) => setNewHwDueDate(e.target.value)}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <Button size="sm" variant="accent" onClick={() => void handleAddHomework()}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAddingHw(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {homeworkList.length === 0 ? (
                    <div style={{ padding: 36, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
                      No action items logged yet. Add one to track follow-ups.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {homeworkList.map((hw) => (
                        <div
                          key={hw.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "10px 12px",
                            background: theme.cardBgSubtle,
                            border: `1px solid ${theme.border}`,
                            borderRadius: 8,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={hw.done}
                              onChange={(e) => void handleToggleHomework(hw.id, e.target.checked)}
                              style={{ cursor: "pointer", width: 16, height: 16 }}
                            />
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <span
                                style={{
                                  fontSize: 13.5,
                                  fontWeight: 500,
                                  color: hw.done ? theme.textMuted : theme.textStrong,
                                  textDecoration: hw.done ? "line-through" : "none",
                                }}
                              >
                                {hw.title}
                              </span>
                              {hw.due_date && (
                                <span style={{ fontSize: 11.5, color: theme.textFaint }}>
                                  Due: {hw.due_date}
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => void handleDeleteHomework(hw.id)}
                            style={{
                              border: "none",
                              background: "transparent",
                              cursor: "pointer",
                              color: theme.textMuted,
                              padding: 4,
                            }}
                            title="Delete action item"
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* Oatmeal Grounded Ask Bar for Meeting */}
              <div style={{ marginTop: 24 }}>
                <OatmealAskBar
                  key={selectedMeeting.id}
                  items={selectedMeeting ? (meetingQAHistory[selectedMeeting.id] ?? []) : []}
                  onAsk={handleMeetingAsk}
                  onDismiss={handleDismissMeetingQA}
                  placeholder={`Ask anything about ${selectedMeeting.title}...`}
                  suggestions={["Key decisions", "Action items", "Main topics", "Next steps", "Pillars / Takeaways"]}
                  disabled={!selectedMeeting.transcribed}
                  stickyBottom={true}
                />
              </div>
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

pub mod chat;
pub mod homework;
pub mod local_llm;
pub mod recall;
pub mod study;

pub use chat::{
    ask_meeting, draft_followup, write_notes, FollowupStyle, Template,
};
pub use homework::{
    add_homework, delete_homework, list_homework, set_homework_done, HomeworkItem,
};
pub use recall::{answer as ask_library, LibraryAnswer, Source};
pub use study::{
    generate_flashcards, generate_quiz, generate_study_plan, Difficulty, Flashcard, QuizQuestion,
    StudySettings,
};

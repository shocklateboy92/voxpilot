# Voice Control — Requirements

> **Status:** Draft — capturing initial requirements from voice input.

VoxPilot's core premise is coding from a mobile device. Voice control is the
natural next step: hands-free interaction with the agent, review overlay, and
session/project management.

---

## 1. Session Management

### 1.1 Create a new session
- Voice command to create a new chat session (in the current project/worktree).
- Optionally give it an initial prompt or title by voice.

### 1.2 Switch to a session
- Voice command to switch to an existing session by name/title.
- Fuzzy matching on session titles (voice transcription won't be exact).

### 1.3 Switch to sessions demanding attention
- Voice command to jump to the next session that requires user action:
  - Tool confirmation pending (`requiresConfirmation` pause)
  - Agent question awaiting answer (`QuestionBlock`)
  - Review changeset ready for review
- If multiple sessions need attention, cycle through them in order.

---

## 2. Project & Worktree Management

### 2.1 Create a new project
- Voice command to set up a new project workspace.
- May involve cloning a repo or registering an existing directory.

### 2.2 Create a git worktree for a project
- Voice command to create a new git worktree from the current project.
- Specify branch name by voice.

### 2.3 Create a session in a specific project/worktree
- Voice command to start a new session scoped to a particular project or worktree.
- Combine project selection + session creation in one utterance
  (e.g. "new session in voxpilot feature-branch").

---

## 3. Agent Interaction

### 3.1 Dictate messages to the agent
- Voice is the primary input method — speak a prompt and it's sent directly
  to the active session's agent. **No compose/confirm step** — the LLM is
  tolerant of transcription errors and can self-correct.
- "Let's build" / "let's plan" — switch to the **Build** or **Plan** agent
  mode (modelled after OpenCode's two primary agents) and begin dictating.
- The agent mode keyword acts as both a mode selector and a conversation
  starter: "let's build a REST endpoint for user profiles" sends the prompt
  to the Build agent in one utterance.
- If the transcription was wrong, say "undo" or "fix that" to retract the
  last message before the agent acts on it (see §5.3).
- **Review comments are the exception** — those use a compose → confirm flow
  because they attach to specific code and precision matters (see §4.3).

### 3.2 Answer agent questions
- When the agent asks a question (`QuestionBlock` with options), answer by
  voice: "pick option 2", "choose the first one", or speak the option label.
- For free-text questions, dictate the answer directly.

### 3.3 Tool confirmations
- Approve or deny tool execution by voice: "approve", "deny", "approve all".

### 3.4 Stop / cancel the agent
- Voice command to interrupt a running agent loop: "stop", "cancel".
- Equivalent to a stop button — the agent halts after the current tool call
  completes.

### 3.5 Voice listener stays active during agent execution
- The voice recognition system must remain listening even while an agent is
  actively responding or executing tools.
- This enables concurrent control: while one agent is working, the user can:
  - Switch to a different session and issue commands there.
  - Stop or cancel the current agent.
  - Create a new session and start a separate task.
- The voice listener is a **global layer** above individual sessions, not
  tied to the lifecycle of any single agent run.

---

## 4. Code Review (Diff Viewer)

### 4.1 Open the diff viewer
- Voice command to open the review overlay when the agent has presented a changeset.

### 4.2 Navigate files in the review carousel
- Voice commands to move between files:
  - "Next file" / "previous file" — carousel navigation.
  - "Go to [filename]" — jump to a specific file.
  - "Next unreviewed file" — skip to the first file not yet marked viewed.

### 4.3 Add comments on semantic code elements
- Voice command to add a review comment targeting a **function**, **class**, or
  **statement** — NOT by line number.
- The system must resolve the spoken name to the correct code location:
  - "Comment on the `handleAuth` function: use a guard clause instead"
  - "Comment on the `User` class: missing the email field"
  - "Comment on the import statement: this should use the named export"
- Backend stores comments based on semantic identifiers instead of line numbers,
  because the review UI auto-formats diffs, making line-numbers meaningless.

### 4.4 Submit review comments to the agent
- Voice command to submit all comments back to the agent once the review is done.
- Equivalent to pressing "Submit Review" on the review summary page.
- Confirm before submitting (voice: "submit review" → "confirmed").
- Optionally include a final comment in the submission command like "address these in a new branch"

---

## 5. Comment Management & Correction

### 5.1 Edit a comment
- Voice command to correct or replace a comment's text.
- "Edit my last comment: change 'guard clause' to 'early return'"
- "Edit comment on `handleAuth`: ..." — target by code element name.
    - agent should ask to disambiguate if multiple comments match the description.

### 5.2 Delete a comment
- Voice command to remove a comment.
- "Delete my last comment" / "Delete comment on `handleAuth`."

### 5.3 Correct transcription errors
- After any voice-to-text input, show the transcribed text.
- Offer corrected version based on AI agent's best guess
- Take user feedback to make further corrections if needed.
- Consider a brief confirmation window after each voice input where the
  user can say "fix that" or "undo" before the input is committed.

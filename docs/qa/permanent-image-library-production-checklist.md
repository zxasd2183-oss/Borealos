# Permanent Image Library Production Gate

Production release remains blocked until every item below has evidence from an authorized environment.

- [ ] Back up one real user directory and verify index/source recovery after a real service restart.
- [ ] Upload the same image through ordinary and chunked upload; confirm one user-scoped library record.
- [ ] Verify two real users cannot list, open, select, translate, or delete each other's image IDs.
- [ ] Load at least 1,000 library records and verify search, all sort modes, and pagination latency.
- [ ] Select 15 mixed uploaded/library images; verify a 16th is rejected and all 15 translate.
- [ ] Translate one source into English, Japanese, and Korean; verify all history entries remain available.
- [ ] Confirm deletion text includes the translation count and deletion removes only the confirmed record's files.
- [ ] Verify desktop, tablet, and mobile layouts, including loading, empty, error, and long-name states.
- [ ] Run an authorized cloud translation smoke test and verify history is written only after the output file exists.
- [ ] Capture rollback steps and confirm the previous upload-only flow still works.

# Known issues

## Currently Reading card spacing

**Status:** Non-blocking visual polish  
**Noted:** 2026-09-22  
**Affected area:** Reading Room skin, homepage, iPhone 17 Pro Max / 440px viewport

The visual refresh shipped with the Currently Reading card structurally aligned so the `CURRENTLY READING` label lines up with the top of the cover and the action buttons line up with the bottom.

There is still some minor real-device spacing polish to revisit for different combinations of title length and metadata. The card is usable and visually acceptable, but the vertical rhythm between the title/author/reading-age group and the progress/actions group can still feel slightly uneven between books.

This is intentionally deferred rather than blocking the visual refresh. When revisiting it, preserve the current top/bottom cover alignment and carousel stability rather than reintroducing dynamic-height or `justify-content: space-between` behaviour.

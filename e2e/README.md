# End-to-end test

`bash e2e/run.sh` builds the app, starts the real server under `portless saladbowl` with a throwaway database, and plays a full game in four phone-sized browser contexts with `playwright-cli`:

- the host signs in, creates a game, sets 2 words each and 10-second turns;
- three players join by the invite link and add words;
- one player's phone is closed mid-turn: the server still ends the turn, the host confirms the review, and the player rejoins by picking their name;
- a fifth player joins mid-game;
- play continues to the end screen on every phone.

It also checks that no phone except the clue-giver's ever has the current card's word in its page.
Prints `E2E PASS` and exits 0 on success.

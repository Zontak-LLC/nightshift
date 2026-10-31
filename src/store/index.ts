// The store layer: the board's state (and later the SQLite history). See SPEC section 7 and CLAUDE.md.
export { Board, type BoardView, type NowRow, type ProjectRow, type Station, type Ticket } from "./board.js";
export type { Desk, DeskState, DesksView, DeskTokens } from "./desks.js";
export { DEFAULT_KEEP_DAYS, type FileState, History, type StoredEvent } from "./history.js";
export { expand, loadPinned, type Pinned, projectTiles, type Tile, watchSiteOf } from "./pinned.js";
export { repoOf } from "./repo.js";
export { type RepoRoot, repoRootOf } from "./root.js";
export type { Alert, Trouble } from "./trouble.js";
export type { AgentRow } from "./workers.js";

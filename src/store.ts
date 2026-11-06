import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { initialState, type State } from "./types.ts";
/** A single transaction owns the small private space. Unknown schema fails closed. */
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS space(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)",
    );
    if (!this.db.prepare("SELECT id FROM space WHERE id=1").get())
      this.db
        .prepare("INSERT INTO space VALUES(1,?)")
        .run(JSON.stringify(initialState()));
    this.read();
  }
  read(): State {
    const s = JSON.parse(
      (
        this.db.prepare("SELECT body FROM space WHERE id=1").get() as {
          body: string;
        }
      ).body,
    );
    if (s.schema !== 1) throw Error("Unsupported database version");
    return s;
  }
  update<T>(fn: (s: State) => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const s = this.read();
      const result = fn(s);
      this.db
        .prepare("UPDATE space SET body=? WHERE id=1")
        .run(JSON.stringify(s));
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  purge() {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
  }
  close() {
    this.db.close();
  }
}

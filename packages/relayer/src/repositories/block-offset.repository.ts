import { DuckDb } from "@src/services/duckdb.service";

export class BlockOffset {
  private duckdb: DuckDb;

  constructor(duckdb: DuckDb) {
    this.duckdb = duckdb;
  }

  public async createTable() {
    const conn = this.duckdb.conn;
    await conn.run(`
            CREATE TABLE IF NOT EXISTS block_offset (
                height UINTEGER
            );
        `);
  }

  public async mayLoadBlockOffset(firstBlockOffset: number) {
    const block_offset = await this.getBlockOffset();
    if (!block_offset) {
      await this.insertBlockOffset(firstBlockOffset);
      return firstBlockOffset;
    }
    return block_offset;
  }

  public async getBlockOffset() {
    const conn = this.duckdb.conn;
    const result = await conn.all(`SELECT * FROM block_offset`);
    if (result.length === 0) {
      return 0;
    }
    return result[0].height as number;
  }

  private async insertBlockOffset(height: number) {
    const conn = this.duckdb.conn;
    await conn.all(`INSERT INTO block_offset VALUES (?)`, height);
  }

  public async updateBlockOffset(height: number) {
    const conn = this.duckdb.conn;
    await conn.all(`UPDATE block_offset SET height = ?`, height);
  }
}

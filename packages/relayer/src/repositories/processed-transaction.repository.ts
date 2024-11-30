import { DuckDb } from "@src/services/duckdb.service";

interface IProcessedTransaction {
  transaction_hash: string;
  created_at: Date;
}

export class ProcessedTransaction {
  private duckdb: DuckDb;

  constructor(duckdb: DuckDb) {
    this.duckdb = duckdb;
  }

  public async createTable() {
    const conn = this.duckdb.conn;
    await conn.run(`
            CREATE TABLE IF NOT EXISTS processed_transaction (
                transaction_hash VARCHAR,
                msg_index INTEGER,
                created_at TIMESTAMP,
                PRIMARY KEY (transaction_hash, msg_index)
            );
        `);
  }

  public async insert(transactionHash: string, msgIndex: number) {
    const conn = this.duckdb.conn;
    await conn.run(
      `INSERT INTO processed_transaction VALUES (?, ?, ?)`,
      transactionHash,
      msgIndex,
      new Date()
    );
  }

  public async get(transactionHash: string, msgIndex: number) {
    const conn = this.duckdb.conn;
    const result = await conn.all(
      `SELECT * FROM processed_transaction WHERE transaction_hash = ? AND msg_index = ?`,
      transactionHash,
      msgIndex
    );
    if (result.length === 0) {
      return undefined;
    }
    return result[0] as IProcessedTransaction;
  }

  public async getAll() {
    const conn = this.duckdb.conn;
    const result = await conn.all(`SELECT * FROM processed_transaction`);
    return result;
  }
}

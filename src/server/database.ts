import { DatabaseSync } from 'node:sqlite';

export class Database extends DatabaseSync {
  private transactionDepth = 0;
  pragma(statement: string) {
    this.exec('PRAGMA ' + statement);
  }

  transaction<T>(operation: () => T) {
    return () => {
      const savepoint = 'nested_' + this.transactionDepth;
      const nested = this.transactionDepth > 0;
      this.exec(nested ? 'SAVEPOINT ' + savepoint : 'BEGIN IMMEDIATE');
      this.transactionDepth++;
      try {
        const result = operation();
        this.exec(nested ? 'RELEASE SAVEPOINT ' + savepoint : 'COMMIT');
        return result;
      } catch (error) {
        this.exec(nested ? 'ROLLBACK TO SAVEPOINT ' + savepoint : 'ROLLBACK');
        if (nested) this.exec('RELEASE SAVEPOINT ' + savepoint);
        throw error;
      } finally {
        this.transactionDepth--;
      }
    };
  }
}

import { DatabaseSync } from 'node:sqlite';

export class Database extends DatabaseSync {
  pragma(statement: string) {
    this.exec('PRAGMA ' + statement);
  }

  transaction<T>(operation: () => T) {
    return () => {
      this.exec('BEGIN IMMEDIATE');
      try {
        const result = operation();
        this.exec('COMMIT');
        return result;
      } catch (error) {
        this.exec('ROLLBACK');
        throw error;
      }
    };
  }
}

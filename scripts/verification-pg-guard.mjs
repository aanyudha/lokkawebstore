import pg from 'pg';
import { assertDisposableName } from './verification-db.ts';

// This preload belongs to the verification process tree. Check the driver's
// resolved target before opening a socket and the server's identity before
// exposing the connected client to a pool or test.
const connect = pg.Client.prototype.connect;
const owner = process.env.LOKKA_VERIFY_OWNER_DB;
pg.Client.prototype.connect = function guardedConnect(callback) {
  if (!callback) {
    return new Promise((resolve, reject) => {
      guardedConnect.call(this, (error) =>
        error ? reject(error) : resolve(this),
      );
    });
  }
  const expected = this.database;
  try {
    assertDisposableName(expected, owner);
  } catch (error) {
    queueMicrotask(() => callback(error));
    return;
  }
  connect.call(this, (error) => {
    if (error) return callback(error);
    this.query('SELECT current_database() AS name', (failure, result) => {
      if (failure || result.rows[0]?.name !== expected) {
        this.end();
        return callback(
          new Error('Verification database identity could not be confirmed.'),
        );
      }
      callback();
    });
  });
};

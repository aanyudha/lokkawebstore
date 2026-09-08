import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Windows child.kill() forcibly terminates processes rather than delivering POSIX
// signals. Exercise the real registered handlers via IPC in this test fixture only.
process.on('message', (signal) => {
  if (signal === 'SIGINT' || signal === 'SIGTERM') {
    process.emit(signal);
    process.disconnect();
  }
});
await import(pathToFileURL(process.argv[2]).href);

import { closeSync, openSync, readSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHerdrExtension } from 'file:///C:/Users/USER/.bun/install/global/node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/herdr/index.js';

const entryPath = fileURLToPath(import.meta.url);
const selfPath = resolve(entryPath).toLowerCase();

export function createSenpiHerdrExtension(deps) {
  return createHerdrExtension({
    ...deps,
    getLoadedExtensionPaths: ctx => deps.getLoadedExtensionPaths(ctx)
      .filter(path => resolve(path).toLowerCase() !== selfPath),
    connect: target => {
      const socket = deps.connect(target);
      const write = socket.write.bind(socket);
      socket.write = (wire, ...arguments_) => {
        const request = JSON.parse(wire);
        if (request.method === 'pane.report_metadata') {
          for (const [field, clear] of [['title', 'clear_title'], ['display_agent', 'clear_display_agent']]) {
            if (request.params[field] === '') {
              delete request.params[field];
              request.params[clear] = true;
            }
          }
        }
        if (request.params.agent === 'pi') {
          request.params.agent = 'senpi';
          const reference = request.params.agent_session_path ?? request.params.agent_session_id;
          if (reference && request.method !== 'pane.release_agent') {
            request.params.resume_argv = ['omo', '--extension', entryPath, '--session', reference];
          }
        }
        return write(`${JSON.stringify(request)}\n`, ...arguments_);
      };
      return socket;
    },
  });
}

export default function herdrSenpi(pi) {
  createSenpiHerdrExtension({
    getLoadedExtensionPaths: ctx => ctx.loadedExtensionPaths ?? [],
    readHeader: path => {
      const file = openSync(path, 'r');
      try {
        const header = Buffer.alloc(400);
        const length = readSync(file, header, 0, header.length, 0);
        return header.subarray(0, length);
      } finally {
        closeSync(file);
      }
    },
    now: Date.now,
    connect: createConnection,
  })(pi);
}

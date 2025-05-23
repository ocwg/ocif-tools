import express from 'express';

import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Store } from '@tldraw/store';
import {
  createTLStore,
  defaultShapeUtils,
  TLAssetStore,
  TLRecord,
  TLStore,
} from '@tldraw/tldraw';
import { JsonCanvasService } from './lib/services/jsoncanvas-service';
import {
  OCIFJson,
  OCIFNode,
  OCIFRelation,
  OCIFResource,
} from './lib/types/ocif';

const app = express();

const server = http.createServer(app);
const io = new Server(server, {
  path: '/api/socket/',
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  console.log('a user connected');
});

app.get('/', (req, res) => {
  res.send({ message: 'Hello API' });
});

// app.listen(port, host, () => {
//   console.log(`[ ready ] http://${host}:${port}`);
// });

server.listen(3000, () => {
  console.log('listening on *:3000');
});

const drawingsDir = path.join(process.cwd(), 'drawings');
const drawingPath = path.join(drawingsDir, 'drawing.json');

let tldrawStore: TLStore | null = null;
let dataStore: Store<TLRecord> | null = null;
let tldrawLastSave: any = null;
let fileWatcher: fs.FSWatcher | null = null;

const myAssetStore: TLAssetStore = {} as TLAssetStore;

function ensureStore() {
  if (!tldrawStore) {
    // Create the tldraw store with the same configuration as client
    tldrawStore = createTLStore({
      shapeUtils: defaultShapeUtils,
      defaultName: 'My Drawing',
      assets: myAssetStore,
      onMount: () => {
        //
      },
    });

    // Create the data store with the same schema and props
    dataStore = new Store({
      schema: tldrawStore.schema,
      props: {
        defaultName: 'My Drawing',
        assets: myAssetStore as Required<TLAssetStore>,
        onMount: () => {
          //
        },
      },
    });

    if (fs.existsSync(drawingPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(drawingPath, 'utf8'));
        dataStore.loadStoreSnapshot(saved);
      } catch (err) {
        console.error('Error loading saved state:', err);
      }
    }
    tldrawLastSave = JSON.stringify(dataStore.getStoreSnapshot());
  }
}

function setupFileWatcher() {
  // Clean up existing watcher if any
  if (fileWatcher) {
    fileWatcher.close();
  }

  // Ensure drawings directory exists
  if (!fs.existsSync(drawingsDir)) {
    fs.mkdirSync(drawingsDir);
  }

  // Watch for file changes
  fileWatcher = fs.watch(drawingsDir, (eventType, filename) => {
    if (filename === 'drawing.json' && eventType === 'change') {
      try {
        setTimeout(() => {
          const fileContent = fs.readFileSync(drawingPath, 'utf8');
          if (fileContent !== tldrawLastSave) {
            console.log('File changed externally, updating clients');
            const newSnapshot = JSON.parse(fileContent);
            if (!dataStore) {
              console.error('Data store is not initialized');
              return;
            }

            // 2. Generate the diff using extractingChanges
            const diff = dataStore.extractingChanges(() => {
              if (!dataStore) {
                console.error(
                  'Data store is not initialized in extractingChanges'
                );
                return;
              }
              dataStore.loadStoreSnapshot(newSnapshot);
            });

            // 3. Update the last save
            tldrawLastSave = fileContent;

            // 4. Broadcast the patch (diff) to all clients
            io.emit('patch', diff);
          }
        }, 100);
      } catch (err) {
        console.error('Error processing file change:', err);
      }
    }
  });

  console.log('File watcher setup complete');
}

ensureStore();
setupFileWatcher();

io.on('connection', (socket) => {
  console.log('Client connected');
  if (!dataStore) {
    console.error('Data store is not initialized');
    return;
  }
  socket.emit('init', dataStore.getStoreSnapshot());

  socket.on('patch', (diff) => {
    try {
      //console.log('Received patch:', JSON.stringify(diff));
      if (!dataStore) {
        console.error('Data store is not initialized in patch');
        return;
      }
      dataStore.applyDiff(diff);
      const snapshot = dataStore.getStoreSnapshot();
      const updated = JSON.stringify(snapshot);
      if (updated !== tldrawLastSave) {
        if (!fs.existsSync(drawingsDir)) {
          fs.mkdirSync(drawingsDir);
        }
        fs.writeFileSync(drawingPath, updated);
        tldrawLastSave = updated;

        const ocifcanvas: OCIFJson = {
          ocif: 'https://canvasprotocol.org/ocif/0.5',
          nodes: [] as OCIFNode[],
          relations: [] as OCIFRelation[],
          resources: [] as OCIFResource[],
        };
        Object.entries(snapshot.store).forEach(([key, value]) => {
          if (value.typeName === 'shape') {
            console.log(value.id, value);
            const helper = value as any;
            ocifcanvas.resources?.push({
              id: `resource-${value.id}`,
              representations: [
                {
                  'mime-type': 'text/plain',
                  content:
                    helper.props.richText.content?.[0]?.content?.[0]?.text ??
                    'test',
                },
              ],
            });
            ocifcanvas.nodes?.push({
              id: value.id,
              position: [value.x, value.y],
              size: [helper.props.w, helper.props.h],
              resource: `resource-${value.id}`,
              data: [
                {
                  type: '@ocif/node/rect',
                  strokeWidth: 1,
                  strokeColor: '#000000',
                  fillColor: '#ffffff',
                },
              ],
            });
          }
        });
        const convertedJSONCanvas =
          JsonCanvasService.convertToJsonCanvas(ocifcanvas);
        fs.writeFileSync(
          path.join(
            process.cwd(),
            'sync',
            'jsoncanvas',
            'localfirst-demo',
            'jsoncanvas.canvas'
          ),
          JSON.stringify(convertedJSONCanvas)
        );
        fs.writeFileSync(
          path.join(process.cwd(), 'sync', 'ocif', 'ocif.ocif.json'),
          JSON.stringify(ocifcanvas)
        );
      }
      // Broadcast to other clients
      //socket.broadcast.emit('patch', diff);
    } catch (err) {
      console.error(
        'Error applying diff:',
        err,
        '\nDiff:',
        JSON.stringify(diff)
      );
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Cleanup on exit
process.on('SIGINT', () => {
  if (fileWatcher) {
    fileWatcher.close();
  }
  process.exit();
});

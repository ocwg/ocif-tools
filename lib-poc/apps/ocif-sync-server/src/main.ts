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
import { TransformService } from './lib/services/transform-service';

const colorNameToHexRgb = (colorName: string) => {
  const colors: { [key: string]: string } = {
    red: '#FF0000',
    green: '#00FF00',
    blue: '#0000FF',
    yellow: '#FFFF00',
    black: '#000000',
    white: '#FFFFFF',
    orange: '#FFA500',
    purple: '#800080',
    pink: '#FFC0CB',
    cyan: '#00FFFF',
    magenta: '#FF00FF',
    gray: '#808080',
    brown: '#A52A2A',
    lime: '#00FF00',
    teal: '#008080',
    navy: '#000080',
    maroon: '#800000',
    olive: '#808000',
    silver: '#C0C0C0',
    gold: '#FFD700',
    coral: '#FF7F50',
    turquoise: '#40E0D0',
    violet: '#EE82EE',
    'light-violet': '#E6E6FA',
    'light-blue': '#ADD8E6',
    'light-red': '#FF7F7F',
    'light-green': '#90EE90',
    'light-yellow': '#FFFFE0',
    'light-orange': '#FFA07A',
    'light-gray': '#D3D3D3',
    'light-brown': '#D2B48C',
    'light-pink': '#FFB6C1',
  };
  return colors[colorName] || colorName;
};

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
let obsidanWatcher: fs.FSWatcher | null = null;
let obsidanLastSave: any = null;
let isSyncingFromTldraw = false;
let isSyncingFromObsidian = false;

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
  if (obsidanWatcher) {
    obsidanWatcher.close();
  }

  // Ensure drawings directory exists
  if (!fs.existsSync(drawingsDir)) {
    fs.mkdirSync(drawingsDir);
  }

  obsidanWatcher = fs.watch(
    path.join(
      process.cwd(),
      'sync',
      'jsoncanvas',
      'localfirst-demo',
      'jsoncanvas.canvas'
    ),
    (eventType, filename) => {
      console.log(
        'obsidian file changed',
        isSyncingFromTldraw,
        isSyncingFromObsidian
      );
      if (isSyncingFromTldraw) {
        console.log('obsedianwatcher STOP isSyncingFromTldraw');
        return;
      }
      console.log('obsidian file changed', eventType, filename);
      try {
        setTimeout(() => {
          isSyncingFromObsidian = true;
          const fileContent = fs.readFileSync(
            path.join(
              process.cwd(),
              'sync',
              'jsoncanvas',
              'localfirst-demo',
              'jsoncanvas.canvas'
            ),
            'utf8'
          );
          //console.log('fileContent', fileContent);
          if (obsidanLastSave === null) {
            obsidanLastSave = fileContent;
            isSyncingFromObsidian = false;
            return;
          }
          if (!tldrawLastSave) {
            console.log('tldrawLastSave is null');
            isSyncingFromObsidian = false;
            return;
          }
          //console.log('obsidanLastSave', obsidanLastSave);
          if (fileContent !== obsidanLastSave) {
            const tldraw = JSON.parse(tldrawLastSave);
            const json = JSON.parse(fileContent);
            const original = JSON.parse(obsidanLastSave);
            const diff = {
              added: {},
              removed: {},
              updated: {} as any,
            };
            json.nodes.forEach((node: any) => {
              const originalNode = original.nodes.find(
                (n: any) => n.id === node.id
              );
              const tldraworgShape = tldraw.store[node.id];
              console.log('tldraworgShape', tldraworgShape);
              if (originalNode && tldraworgShape) {
                if (
                  node.text !== originalNode.text ||
                  node.x !== originalNode.x ||
                  node.y !== originalNode.y ||
                  node.width !== originalNode.width ||
                  node.height !== originalNode.height
                ) {
                  console.log('node updated', node);
                  const tldrawNode = structuredClone(tldraworgShape);
                  tldrawNode.id = node.id;
                  tldrawNode.x = node.x;
                  tldrawNode.y = node.y;
                  tldrawNode.props.w = node.width;
                  tldrawNode.props.h = node.height;
                  tldrawNode.props.richText.content[0].content[0].text =
                    node.text;
                  diff.updated[node.id] = [tldraworgShape, tldrawNode];

                  io.emit('patch', diff);
                }
              }
            });
            const transforrmToOCIF = new TransformService();
            const ocif = transforrmToOCIF.transformJsonCanvasToOCIF(json);
            fs.writeFileSync(
              path.join(process.cwd(), 'sync', 'ocif', 'ocif.ocif.json'),
              JSON.stringify(ocif)
            );
            obsidanLastSave = fileContent;
          } else {
            if (!isSyncingFromObsidian) {
              console.log('obsidanLastSave is the same');
            }
          }
          isSyncingFromObsidian = false;
        }, 100);
      } catch (err) {
        console.error('Error processing file change:', err);
        isSyncingFromObsidian = false;
      }
    }
  );

  // Watch for file changes
  fileWatcher = fs.watch(drawingsDir, (eventType, filename) => {
    if (isSyncingFromObsidian) {
      console.log('tldrawwatcher STOP isSyncingFromObsidian');
      return;
    }
    if (filename === 'drawing.json' && eventType === 'change') {
      try {
        setTimeout(() => {
          isSyncingFromTldraw = true;
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

            isSyncingFromTldraw = false;
          }
        }, 100);
      } catch (err) {
        console.error('Error processing file change:', err);
        isSyncingFromTldraw = false;
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
    if (isSyncingFromObsidian) {
      console.log('socket patch STOP isSyncingFromObsidian');
      return;
    }
    try {
      isSyncingFromTldraw = true;
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
                  fillColor: colorNameToHexRgb(helper.props.color ?? '#ffffff'),
                },
              ],
            });
          }
        });
        const convertedJSONCanvas =
          JsonCanvasService.convertToJsonCanvas(ocifcanvas);
        obsidanLastSave = JSON.stringify(convertedJSONCanvas);
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
      isSyncingFromTldraw = false;
    } catch (err) {
      isSyncingFromTldraw = false;
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
  if (obsidanWatcher) {
    obsidanWatcher.close();
  }
  process.exit();
});

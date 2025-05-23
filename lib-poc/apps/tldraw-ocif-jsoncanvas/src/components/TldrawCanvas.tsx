'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Tldraw,
  createTLStore,
  defaultShapeUtils,
  Editor,
  TLStore,
  TLStoreSnapshot,
  TLRecord,
} from '@tldraw/tldraw';
import { HistoryEntry, Store } from '@tldraw/store';
import { io } from 'socket.io-client';
import '@tldraw/tldraw/tldraw.css';

const emptyAssetStore = {
  upload: async () => ({ src: '' }),
  remove: async () => undefined,
  resolve: async () => null,
};

const noopOnMount = (_editor: Editor) => undefined;

export default function TldrawCanvas() {
  const [store] = useState(() =>
    createTLStore({
      shapeUtils: defaultShapeUtils,
      defaultName: 'My Drawing',
      assets: emptyAssetStore,
      onMount: noopOnMount,
    })
  );
  const [dataStore] = useState(
    () =>
      new Store({
        schema: store.schema,
        props: {
          defaultName: 'My Drawing',
          assets: emptyAssetStore,
          onMount: noopOnMount,
        },
      })
  );
  const editorRef = useRef<Editor | null>(null);
  const socketRef = useRef<any>(null);
  const isRemoteChangeRef = useRef(false);

  useEffect(() => {
    const socket = io('http://localhost:3000', { path: '/api/socket/' });
    socketRef.current = socket;

    socket.on('init', (snapshot: TLStoreSnapshot) => {
      console.log('Received init from server');
      isRemoteChangeRef.current = true;
      try {
        store.loadSnapshot(snapshot);
        dataStore.loadStoreSnapshot(store.getSnapshot('all'));
      } finally {
        isRemoteChangeRef.current = false;
      }
    });

    socket.on('patch', (diff: any) => {
      console.log('Received patch from server', diff);
      isRemoteChangeRef.current = true;
      try {
        dataStore.applyDiff(diff);
        store.loadSnapshot(dataStore.getSnapshot() as TLStoreSnapshot);
      } finally {
        isRemoteChangeRef.current = false;
      }
    });

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
    });

    socket.on('connect_error', (error: any) => {
      console.error('Socket connection error:', error);
    });

    return () => {
      socket.disconnect();
    };
  }, [dataStore, store]);

  const handleChange = (editor: Editor, change: HistoryEntry<TLRecord>) => {
    if (isRemoteChangeRef.current) return;
    if (!socketRef.current?.connected) return;
    if (change.source !== 'user') return;

    if (change) {
      socketRef.current.emit('patch', change.changes);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        store={store}
        onMount={(editor) => {
          editorRef.current = editor;
          editor.store.listen((change) => handleChange(editor, change));
        }}
      />
    </div>
  );
}

import { WebSocketServer, WebSocket } from 'ws';

const port = process.env.PORT || 3000;
const wss = new WebSocketServer({ port });

// State to hold rooms and their peers
// Map<roomId, Map<peerId, WebSocket>>
const rooms = new Map();

wss.on('connection', (ws) => {
  console.log('New client connected');

  // Keep track of which room this socket is in to clean up on disconnect
  let currentRoomId = null;
  let currentPeerId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          handleJoin(ws, data);
          break;
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          handleSignalingMessage(data);
          break;
        case 'leave':
          handleLeave();
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    handleLeave();
    console.log('Client disconnected');
  });

  function handleJoin(ws, data) {
    const { roomId, peerId, role } = data; // role could be 'sender' or 'viewer'
    if (!roomId || !peerId) return;

    currentRoomId = roomId;
    currentPeerId = peerId;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    const room = rooms.get(roomId);
    room.set(peerId, { ws, role });

    console.log(`Peer ${peerId} joined room ${roomId} as ${role}`);

    // Notify other peers in the room
    broadcastToRoom(roomId, peerId, {
      type: 'peer-joined',
      peerId: peerId,
      role: role
    });

    // Send the list of existing peers to the new peer
    const existingPeers = [];
    for (const [id, peerData] of room.entries()) {
      if (id !== peerId) {
        existingPeers.push({ peerId: id, role: peerData.role });
      }
    }
    
    ws.send(JSON.stringify({
      type: 'room-info',
      peers: existingPeers
    }));
  }

  function handleSignalingMessage(data) {
    const { targetPeerId } = data;
    if (!currentRoomId || !targetPeerId) return;

    const room = rooms.get(currentRoomId);
    if (!room) return;

    const targetPeer = room.get(targetPeerId);
    if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
      // Add the sender's peerId to the message so the target knows who it's from
      const messageToSend = { ...data, senderPeerId: currentPeerId };
      targetPeer.ws.send(JSON.stringify(messageToSend));
    }
  }

  function handleLeave() {
    if (!currentRoomId || !currentPeerId) return;

    const room = rooms.get(currentRoomId);
    if (room) {
      room.delete(currentPeerId);
      console.log(`Peer ${currentPeerId} left room ${currentRoomId}`);

      // Notify others
      broadcastToRoom(currentRoomId, currentPeerId, {
        type: 'peer-left',
        peerId: currentPeerId
      });

      // Clean up empty rooms
      if (room.size === 0) {
        rooms.delete(currentRoomId);
        console.log(`Room ${currentRoomId} deleted (empty)`);
      }
    }

    currentRoomId = null;
    currentPeerId = null;
  }

  function broadcastToRoom(roomId, excludePeerId, message) {
    const room = rooms.get(roomId);
    if (!room) return;

    const msgString = JSON.stringify(message);
    for (const [id, peerData] of room.entries()) {
      if (id !== excludePeerId && peerData.ws.readyState === WebSocket.OPEN) {
        peerData.ws.send(msgString);
      }
    }
  }
});

console.log(`Signaling server running on port ${port}`);

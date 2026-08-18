# Ministream

Ministream is a WebRTC-based platform designed for enterprise media sharing, multi-user collaboration, and direct integration with OBS Studio for professional broadcasting. 

It provides a low-latency, peer-to-peer mesh network that allows multiple guests to join a unified lobby, share their cameras and microphones, and dynamically composite their feeds into a single browser source for live production.

## Core Features

*   **P2P Mesh Architecture:** Direct WebRTC connections between peers for minimum latency and maximum quality.
*   **Multi-User Lobby:** Bidirectional audio and video communication among participants in the same room.
*   **Dynamic Gallery:** Automatic responsive grid layout that adapts to the number of active participants.
*   **OBS Integration:** Transparent background mode (`?obs=1`) designed specifically to be captured via OBS Browser Source.
*   **Real-Time Video Processing:** Hardware-accelerated canvas processing for brightness, contrast, zoom, and blur controls.
*   **AI Background Removal:** Integrated MediaPipe Selfie Segmentation for real-time background removal and chroma key substitution.
*   **Device Management:** Hot-swapping capabilities for audio and video input devices.

## Project Structure

The project is divided into two decoupled components:

1.  **Frontend (Client):** A static web application built with Vanilla JavaScript and Vite. It handles the WebRTC engine, video processing, and user interface.
2.  **Backend (Signaling Server):** A lightweight Node.js WebSocket server responsible exclusively for peer discovery and SDP exchange. It does not relay media.

## Local Development

### Prerequisites

*   Node.js (v18 or higher)
*   npm

### Setup the Signaling Server

1. Navigate to the server directory:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the WebSocket server (defaults to port 3000):
   ```bash
   npm start
   ```

### Setup the Frontend

1. Open a new terminal and navigate to the project root:
   ```bash
   cd ministream
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```

The frontend will be available at `http://localhost:5173`. WebRTC features require access via `localhost` or a secure `HTTPS` connection to acquire camera and microphone permissions.

## Deployment Architecture

For production environments, it is recommended to decouple the deployment:

*   **Frontend:** Host on static edge networks such as Vercel, Netlify, or Cloudflare Pages.
*   **Backend:** Host the WebSocket server on PaaS providers like Render, Railway, or a dedicated VPS.
*   **TURN Server:** For reliable connections across restrictive corporate firewalls or symmetric NATs, integrating a TURN server (e.g., Coturn, Twilio NAT Traversal, or Metered.ca) is strongly advised.

Configure the frontend to locate the production signaling server by setting the `VITE_WS_URL` environment variable during the build process (e.g., `VITE_WS_URL=wss://your-backend-url.com`).

## License

This project is licensed under the MIT License - see the LICENSE file for details.

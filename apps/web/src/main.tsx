import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, type Socket } from 'socket.io-client';
import './style.css';
type Message = { id: string; name: string; text: string; created: number };
type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
function App() {
  const room = location.pathname.match(/^\/room\/([\w-]{24})$/)?.[1];
  const [name, setName] = useState(sessionStorage.getItem('displayName') || '');
  const [joined, setJoined] = useState(false), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready when you are'), [error, setError] = useState('');
  const [peerName, setPeerName] = useState(''), [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(''), [mic, setMic] = useState(true), [camera, setCamera] = useState(true);
  const [copied, setCopied] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null), remoteVideo = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null), socket = useRef<Socket | null>(null), pc = useRef<RTCPeerConnection | null>(null);
  const pending = useRef<RTCIceCandidateInit[]>([]), remoteId = useRef(''), ice = useRef<RTCIceServer[]>([]), alive = useRef(true);
  function closePeer() { pc.current?.close(); pc.current = null; pending.current = []; remoteId.current = ''; if (remoteVideo.current) remoteVideo.current.srcObject = null; }
  function cleanup() { socket.current?.disconnect(); socket.current = null; closePeer(); stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; }
  useEffect(() => { alive.current = true; return () => { alive.current = false; cleanup(); }; }, []);
  useEffect(() => { if (joined && localVideo.current) localVideo.current.srcObject = stream.current; }, [joined]);
  function connection(target: string) {
    closePeer(); remoteId.current = target;
    const peer = new RTCPeerConnection({ iceServers: ice.current }); pc.current = peer;
    stream.current?.getTracks().forEach(t => peer.addTrack(t, stream.current!));
    peer.onicecandidate = e => { if (e.candidate) socket.current?.emit('signal', { target, data: { candidate: e.candidate.toJSON() } }); };
    peer.ontrack = e => { if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0]; };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') { setStatus('Connected'); setError(''); }
      if (peer.connectionState === 'failed') { setStatus('Connection failed'); setError('Could not connect media. Try rejoining. Some networks require a configured TURN server.'); }
      if (peer.connectionState === 'disconnected') setStatus('Connection interrupted');
    };
    return peer;
  }
  async function join() {
    if (!name.trim() || !room || busy) return;
    setBusy(true); setError(''); setStatus('Checking camera and microphone…');
    try {
      const check = await fetch(`/api/rooms/${room}`); if (!check.ok) throw new Error('This room is missing or has expired. Create a new room.');
      if (!navigator.mediaDevices) throw new Error('Camera access requires localhost or an HTTPS connection.');
      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (!alive.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const config = await fetch('/api/ice'); if (!config.ok) throw new Error('Could not load connection settings.'); ice.current = (await config.json()).iceServers;
      const s = io({ autoConnect: false, reconnection: false }); socket.current = s;
      s.on('connect_error', () => { setError('Cannot reach the server. Please try again.'); setBusy(false); cleanup(); });
      s.on('disconnect', reason => { if (reason !== 'io client disconnect') { cleanup(); setJoined(false); setBusy(false); setError('Disconnected from the server. Rejoin to reconnect.'); } });
      s.on('peer-joined', ({ name: n }) => { setPeerName(n); setStatus('Connecting…'); });
      s.on('peer-left', () => { closePeer(); setPeerName(''); setStatus('Your guest left. Waiting for someone to join…'); });
      s.on('message', m => setMessages(prev => [...prev, m].slice(-100)));
      s.on('signal', async ({ from, data }: { from: string; data: Signal }) => {
        try {
          let peer = pc.current;
          if (data.description?.type === 'offer') {
            peer = connection(from); await peer.setRemoteDescription(data.description);
            for (const c of pending.current.splice(0)) await peer.addIceCandidate(c);
            await peer.setLocalDescription(await peer.createAnswer());
            s.emit('signal', { target: from, data: { description: peer.localDescription?.toJSON() } });
          } else if (data.description && peer && from === remoteId.current) {
            await peer.setRemoteDescription(data.description);
            for (const c of pending.current.splice(0)) await peer.addIceCandidate(c);
          } else if (data.candidate) {
            if (peer?.remoteDescription && from === remoteId.current) await peer.addIceCandidate(data.candidate);
            else if (pending.current.length < 100) pending.current.push(data.candidate);
          }
        } catch { setError('Media connection failed. Leave and rejoin to try again.'); }
      });
      s.on('connect', () => s.timeout(10000).emit('join', { room, name: name.trim() }, async (timeout: Error | null, result: { error?: string; peers: { id: string; name: string }[]; messages: Message[] }) => {
        if (timeout || result.error) { setError(result?.error || 'Joining timed out. Please try again.'); setBusy(false); cleanup(); return; }
        sessionStorage.setItem('displayName', name.trim()); setJoined(true); setMic(true); setCamera(true); setMessages(result.messages); setBusy(false); setStatus('Waiting for your guest…');
        if (result.peers[0]) {
          setPeerName(result.peers[0].name); setStatus('Connecting…');
          try { const peer = connection(result.peers[0].id); await peer.setLocalDescription(await peer.createOffer()); s.emit('signal', { target: result.peers[0].id, data: { description: peer.localDescription?.toJSON() } }); }
          catch { setError('Could not start the call. Please rejoin.'); }
        }
      }));
      s.connect();
    } catch (e) { cleanup(); setBusy(false); setStatus('Ready when you are'); setError(e instanceof DOMException ? 'Camera or microphone unavailable. Allow access in your browser and try again.' : (e as Error).message); }
  }
  async function create() { setBusy(true); setError(''); try { const r = await fetch('/api/rooms', { method: 'POST' }); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Could not create a room.'); location.assign(`/room/${data.id}`); } catch(e) { setError((e as Error).message); setBusy(false); } }
  async function copy() { try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setError('Copy the room URL from your address bar to invite someone.'); } }
  function leave() { cleanup(); setJoined(false); setPeerName(''); setStatus('You left the call'); }
  function toggle(kind: 'audio' | 'video') { const enabled = kind === 'audio' ? !mic : !camera; stream.current?.getTracks().filter(t => t.kind === kind).forEach(t => { t.enabled = enabled; }); kind === 'audio' ? setMic(enabled) : setCamera(enabled); }
  function send(e: React.FormEvent) { e.preventDefault(); const text = draft.trim(); if (!text) return; socket.current?.timeout(5000).emit('message', text, (err: Error | null, result: {error?: string}) => { if (err || result.error) setError(result?.error || 'Message not sent. Try again.'); else setDraft(''); }); }
  return <div className="shell"><header><a className="brand" href="/">◉ <span>Video Calls</span></a><span className="header-note">A LITTLE CLOSER.</span><span className="pill">● Built for two</span></header>
    {!room ? <main className="landing"><section><div className="eyebrow">LESS SETUP. MORE CONVERSATION.</div><h1>Good conversations<br/>start <em>here.</em></h1><p className="intro">A quiet space for your next catch-up.<br/>One link. Two people. Face to face.</p><button className="primary" onClick={create} disabled={busy}>{busy ? 'Creating your room…' : 'Start a conversation'} <span>↗</span></button><p className="hint">No account needed. Your room lasts 24 hours.</p></section><div className="hero-art"><div className="art-label">YOUR NEXT GREAT CONVERSATION</div><div className="portrait one">K<span>YOU</span></div><div className="portrait two">?<span>YOUR PERSON</span></div><div className="art-caption">Different places.<br/><em>Same moment.</em></div><div className="dots">● ● ●</div></div><div className="features"><div><b>01 / Share a link</b><p>Create a room and invite your person.</p></div><div><b>02 / Make it personal</b><p>Camera, microphone, and a little time.</p></div><div><b>03 / Stay in the moment</b><p>Video and chat, without the clutter.</p></div></div></main> : !joined ? <main className="lobby"><div className="eyebrow">YOUR CONVERSATION SPACE</div><h1>Come on in.</h1><p className="intro">Choose a name. We’ll ask for your camera<br/>and microphone when you join.</p><form onSubmit={e => { e.preventDefault(); join(); }}><label htmlFor="name">Your name</label><input id="name" value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="e.g. Konstantin" autoComplete="given-name" required/><button className="primary" disabled={busy || !name.trim()}>{busy ? 'Getting things ready…' : 'Join conversation'} ↗</button></form><button className="text-button" onClick={copy}>{copied ? 'Link copied ✓' : 'Copy invitation link'}</button><p className="hint">Anyone with the link can join and read this room’s chat.<br/>Two people maximum. Rooms expire after 24 hours.</p></main> : <main className="call-layout"><section className="stage"><div className="stage-heading"><div><div className="eyebrow">JUST THE TWO OF YOU</div><h2>Your conversation</h2></div><button className="secondary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy invite ↗'}</button></div><div className="video-stage"><video ref={remoteVideo} autoPlay playsInline/><div className="waiting" hidden={status === 'Connected'}><div className="avatar">{peerName ? peerName[0].toUpperCase() : '↗'}</div><h3>{peerName || 'A seat for your person'}</h3><p role="status">{status}</p></div><span className="video-label">{peerName || 'Your guest'}</span><div className="local-video"><video ref={localVideo} autoPlay playsInline muted/><span>You{!camera ? ' · camera off' : ''}</span></div></div><div className="controls"><button className={!mic ? 'off' : ''} aria-pressed={!mic} onClick={() => toggle('audio')}>{mic ? 'Mute mic' : 'Unmute mic'}</button><button className={!camera ? 'off' : ''} aria-pressed={!camera} onClick={() => toggle('video')}>{camera ? 'Camera off' : 'Camera on'}</button><button className="leave" onClick={leave}>Leave call ↗</button></div><p className="hint">{status} · Peer-to-peer media</p></section><aside><div className="chat-heading"><h2>In the conversation</h2><span>CHAT</span></div><div className="messages" aria-live="polite" role="log">{!messages.length && <p className="empty">A link, a thought, a little hello.<br/>Your messages go here.</p>}{messages.map(m => <div className="message" key={m.id}><b>{m.name}</b><time>{new Date(m.created).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time><p>{m.text}</p></div>)}</div><form className="chat-form" onSubmit={send}><input aria-label="Message" placeholder="Say something…" maxLength={2000} value={draft} onChange={e => setDraft(e.target.value)}/><button aria-label="Send message" disabled={!draft.trim()}>↑</button></form><p className="chat-note">Chat is stored on the server until room cleanup.</p></aside></main>}
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}<footer><span>Small room. Real connection.</span><span>VIDEO CALLS / 2026 EDITION</span></footer></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);

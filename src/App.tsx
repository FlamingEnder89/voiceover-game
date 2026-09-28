import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

type Segment = {
  id: string;
  label: string;
  start: number;
  end: number;
  volume: number;
  audioUrl: string;
};

type Selection = {
  start: number;
  end: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const formatTime = (seconds: number) => {
  const safe = Number.isFinite(seconds) ? seconds : 0;
  const totalSeconds = Math.max(0, Math.floor(safe));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const parseYoutubeId = (value: string) => {
  const match = value.match(/(?:v=|\.be\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
};

const defaultSelection = (duration: number): Selection => ({
  start: 0,
  end: Math.min(2, duration || 2),
});

const App = () => {
  const [projectName, setProjectName] = useState('My Voiceover Project');
  const [sourceType, setSourceType] = useState<'upload' | 'youtube'>('upload');
  const [videoUrl, setVideoUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoDuration, setVideoDuration] = useState(60);
  const [playhead, setPlayhead] = useState(0);
  const [selection, setSelection] = useState<Selection>(defaultSelection(60));
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [originalVolume, setOriginalVolume] = useState(0.8);
  const [voiceVolume, setVoiceVolume] = useState(1);
  const [statusMessage, setStatusMessage] = useState('Ready to record.');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const currentRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const recordedChunksRef = useRef<Blob[]>([]);
  const stopRecordingListenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('voiceover-project');
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as {
        projectName?: string;
        sourceType?: 'upload' | 'youtube';
        videoUrl?: string;
        youtubeUrl?: string;
        segments?: Segment[];
        videoDuration?: number;
        selection?: Selection;
        originalVolume?: number;
        voiceVolume?: number;
      };

      if (parsed.projectName) setProjectName(parsed.projectName);
      if (parsed.sourceType) setSourceType(parsed.sourceType);
      if (parsed.videoUrl) setVideoUrl(parsed.videoUrl);
      if (parsed.youtubeUrl) setYoutubeUrl(parsed.youtubeUrl);
      if (parsed.segments) setSegments(parsed.segments);
      if (parsed.videoDuration) setVideoDuration(parsed.videoDuration);
      if (parsed.selection) setSelection(parsed.selection);
      if (parsed.originalVolume !== undefined) setOriginalVolume(parsed.originalVolume);
      if (parsed.voiceVolume !== undefined) setVoiceVolume(parsed.voiceVolume);
    } catch (error) {
      console.warn('Failed to load saved project', error);
    }
  }, []);

  useEffect(() => {
    const projectData = {
      projectName,
      sourceType,
      videoUrl,
      youtubeUrl,
      segments,
      videoDuration,
      selection,
      originalVolume,
      voiceVolume,
    };

    localStorage.setItem('voiceover-project', JSON.stringify(projectData));
  }, [projectName, sourceType, videoUrl, youtubeUrl, segments, videoDuration, selection, originalVolume, voiceVolume]);

  useEffect(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    video.volume = originalVolume;
  }, [originalVolume]);

  useEffect(() => {
    Object.values(audioRefs.current).forEach((audio) => {
      audio.volume = (audio.volume || 1) * voiceVolume;
    });
  }, [voiceVolume]);

  const effectiveDuration = useMemo(() => Math.max(videoDuration, ...segments.map((segment) => segment.end), 10), [videoDuration, segments]);

  const syncPreviewAudio = (currentTime: number) => {
    segments.forEach((segment) => {
      const audio = audioRefs.current[segment.id];
      if (!audio) return;

      if (currentTime >= segment.start && currentTime <= segment.end) {
        if (audio.paused) {
          audio.currentTime = 0;
          audio.play().catch(() => undefined);
        }
        audio.volume = segment.volume * voiceVolume;
      } else {
        audio.pause();
        audio.currentTime = 0;
      }
    });
  };

  const stopMediaRecorder = () => {
    if (currentRecorderRef.current && currentRecorderRef.current.state !== 'inactive') {
      currentRecorderRef.current.stop();
    }

    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    currentRecorderRef.current = null;
    setIsRecording(false);
    setStatusMessage('Recording saved to the timeline.');
  };

  const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const nextDuration = event.currentTarget.duration || videoDuration || 60;
    setVideoDuration(nextDuration);
    setSelection((current) => ({
      start: clamp(current.start, 0, nextDuration),
      end: clamp(current.end || 2, 0, nextDuration),
    }));
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setSourceType('upload');
    setYoutubeUrl('');
    setSelection(defaultSelection(60));
    setStatusMessage(`Loaded ${file.name}. Set a selection and record your voice-over.`);
  };

  const handleYoutubeSubmit = () => {
    const trimmed = youtubeUrl.trim();
    if (!trimmed) {
      setStatusMessage('Paste a valid YouTube URL to continue.');
      return;
    }

    const youtubeId = parseYoutubeId(trimmed);
    if (!youtubeId) {
      setStatusMessage('That URL does not look like a valid YouTube link.');
      return;
    }

    const embedUrl = `https://www.youtube.com/embed/${youtubeId}?rel=0`;
    setVideoUrl(embedUrl);
    setSourceType('youtube');
    setSelection(defaultSelection(60));
    setStatusMessage('YouTube preview loaded. Your timeline still works alongside the embed preview.');
  };

  const handleScrub = (nextTime: number) => {
    const safeTime = clamp(nextTime, 0, effectiveDuration);
    setPlayhead(safeTime);

    if (videoRef.current) {
      videoRef.current.currentTime = safeTime;
    }
  };

  const handlePlayPause = async () => {
    if (!videoRef.current && sourceType !== 'youtube') {
      setStatusMessage('Load a video before previewing.');
      return;
    }

    if (sourceType === 'youtube') {
      setStatusMessage('YouTube preview is embedded. Use the current bar to estimate the selection and record against the clip.');
      return;
    }

    if (videoRef.current) {
      if (videoRef.current.paused) {
        await videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const startSelectionFromPlayhead = () => {
    const end = clamp(playhead + 2, 0, effectiveDuration);
    setSelection({ start: playhead, end });
    setStatusMessage('Selection placed. Press record to capture a voice-over line.');
  };

  const updateSelectionStart = (value: number) => {
    setSelection((current) => ({
      start: clamp(value, 0, current.end),
      end: current.end,
    }));
  };

  const updateSelectionEnd = (value: number) => {
    setSelection((current) => ({
      start: current.start,
      end: clamp(value, current.start, effectiveDuration),
    }));
  };

  const saveSegment = (blob: Blob, range: Selection) => {
    const audioUrl = URL.createObjectURL(blob);
    const nextSegment: Segment = {
      id: crypto.randomUUID(),
      label: `Voice ${segments.length + 1}`,
      start: range.start,
      end: range.end,
      volume: 1,
      audioUrl,
    };

    setSegments((current) => [...current, nextSegment]);
    setSelection(range);
    setStatusMessage(`Saved ${nextSegment.label} at ${formatTime(range.start)} – ${formatTime(range.end)}.`);
  };

  const recordSelectedSegment = async () => {
    if (!selection || sourceType === 'youtube') {
      setStatusMessage('Use the uploaded video for recording. YouTube embeds are best used as a reference while you record a local take.');
      return;
    }

    if (!videoRef.current) {
      setStatusMessage('Load a video before recording.');
      return;
    }

    if (isRecording) {
      stopMediaRecorder();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      currentRecorderRef.current = recorder;
      audioStreamRef.current = stream;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const outputBlob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        saveSegment(outputBlob, selection);
        stream.getTracks().forEach((track) => track.stop());
        currentRecorderRef.current = null;
        audioStreamRef.current = null;
        setIsRecording(false);
      };

      const video = videoRef.current;
      setIsRecording(true);
      setStatusMessage('Recording… follow the selected range while the video plays.');

      const handleTimeUpdate = () => {
        if (video.currentTime >= selection.end) {
          video.pause();
          video.removeEventListener('timeupdate', handleTimeUpdate);
          stopMediaRecorder();
        }
      };

      stopRecordingListenerRef.current = handleTimeUpdate;
      video.addEventListener('timeupdate', handleTimeUpdate);
      video.currentTime = selection.start;
      await video.play();
      setIsPlaying(true);
      recorder.start();
    } catch (error) {
      console.error(error);
      setStatusMessage('Microphone access was blocked. Please allow microphone permission and try again.');
    }
  };

  const startSetFromSelection = (segment: Segment) => {
    setSelection({ start: segment.start, end: segment.end });
    setPlayhead(segment.start);

    if (videoRef.current) {
      videoRef.current.currentTime = segment.start;
    }
  };

  const updateSegmentVolume = (segmentId: string, value: number) => {
    setSegments((current) =>
      current.map((segment) =>
        segment.id === segmentId
          ? { ...segment, volume: value }
          : segment,
      ),
    );
  };

  const trimSegment = (segmentId: string, direction: 'start' | 'end', amount: number) => {
    setSegments((current) =>
      current.map((segment) => {
        if (segment.id !== segmentId) return segment;

        if (direction === 'start') {
          return { ...segment, start: clamp(segment.start + amount, 0, segment.end - 0.1) };
        }

        return { ...segment, end: clamp(segment.end + amount, segment.start + 0.1, effectiveDuration) };
      }),
    );
  };

  const deleteSegment = (segmentId: string) => {
    setSegments((current) => current.filter((segment) => segment.id !== segmentId));
    const audio = audioRefs.current[segmentId];
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    setStatusMessage('Voice-over block removed.');
  };

  const rebuildSegmentRecording = async (segmentId: string) => {
    const segment = segments.find((item) => item.id === segmentId);
    if (!segment || !videoRef.current) return;

    const existingBlob = await fetch(segment.audioUrl).then((response) => response.blob());
    const reopenedUrl = URL.createObjectURL(existingBlob);
    setSegments((current) =>
      current.map((item) =>
        item.id === segmentId
          ? { ...item, audioUrl: reopenedUrl }
          : item,
      ),
    );

    setStatusMessage('Re-recording uses the same placement and will replace the segment after you record again.');
  };

  const saveProject = () => {
    localStorage.setItem(
      'voiceover-project',
      JSON.stringify({
        projectName,
        sourceType,
        videoUrl,
        youtubeUrl,
        segments,
        videoDuration,
        selection,
        originalVolume,
        voiceVolume,
      }),
    );
    setStatusMessage('Project saved locally in the browser.');
  };

  const exportProject = async () => {
    if (!videoRef.current || !videoUrl || sourceType !== 'upload') {
      setStatusMessage('Export works best for a locally uploaded video.');
      return;
    }

    const video = videoRef.current;
    const outputLength = Math.max(videoDuration, ...segments.map((segment) => segment.end), 1);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const combinedStream = canvas.captureStream(30);
    const videoStream = video.captureStream?.();

    videoStream?.getAudioTracks().forEach((track) => combinedStream.addTrack(track));

    segments.forEach((segment) => {
      const voiceAudio = new Audio(segment.audioUrl);
      voiceAudio.volume = segment.volume * voiceVolume;
      const trackStream = voiceAudio.captureStream?.();
      trackStream?.getAudioTracks().forEach((track) => combinedStream.addTrack(track));
      setTimeout(() => voiceAudio.play().catch(() => undefined), segment.start * 1000);
      setTimeout(() => voiceAudio.pause(), segment.end * 1000 + 200);
    });

    const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp9,opus' });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${projectName.replace(/\s+/g, '-').toLowerCase() || 'voiceover-export'}.webm`;
      link.click();
      setStatusMessage('Exported a preview mix as a WebM file.');
    };

    recorder.start();
    video.currentTime = 0;
    video.play();

    const renderLoop = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      requestAnimationFrame(renderLoop);
    };

    renderLoop();
    setTimeout(() => {
      video.pause();
      recorder.stop();
    }, outputLength * 1000 + 400);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title-block">
          <span className="eyebrow">Voice Over Studio</span>
          <input
            className="project-name"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            aria-label="Project name"
          />
        </div>

        <div className="topbar-actions">
          <button onClick={handlePlayPause}>{isPlaying ? 'Pause preview' : 'Play preview'}</button>
          <button onClick={recordSelectedSegment}>{isRecording ? 'Stop record' : 'Record line'}</button>
          <button onClick={saveProject}>Save project</button>
          <button onClick={exportProject}>Export mix</button>
        </div>
      </header>

      <main className="main-grid">
        <section className="media-panel panel">
          <div className="panel-header">
            <h2>Video source</h2>
          </div>

          <div className="source-tabs">
            <button className={sourceType === 'upload' ? 'active' : ''} onClick={() => setSourceType('upload')}>
              Upload clip
            </button>
            <button className={sourceType === 'youtube' ? 'active' : ''} onClick={() => setSourceType('youtube')}>
              YouTube link
            </button>
          </div>

          {sourceType === 'upload' ? (
            <label className="upload-box">
              <input type="file" accept="video/*" capture="environment" onChange={handleUpload} />
              <span>Choose a video from your phone or computer</span>
            </label>
          ) : (
            <div className="youtube-box">
              <input
                type="url"
                placeholder="Paste a YouTube URL"
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
              />
              <button onClick={handleYoutubeSubmit}>Load video</button>
            </div>
          )}

          <div className="stage">
            {sourceType === 'upload' && videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                playsInline
                onLoadedMetadata={handleVideoMetadata}
                onTimeUpdate={(event) => {
                  const currentTime = event.currentTarget.currentTime;
                  setPlayhead(currentTime);
                  syncPreviewAudio(currentTime);
                }}
                onPause={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
              />
            ) : sourceType === 'youtube' && youtubeUrl ? (
              <iframe
                title="YouTube preview"
                src={`https://www.youtube.com/embed/${parseYoutubeId(youtubeUrl) ?? ''}?rel=0`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="empty-state">Your preview will show here.</div>
            )}
          </div>

          <div className="time-bar">
            <span>{formatTime(playhead)}</span>
            <input
              type="range"
              min={0}
              max={effectiveDuration}
              step={0.1}
              value={playhead}
              onChange={(event) => handleScrub(Number(event.target.value))}
            />
            <span>{formatTime(effectiveDuration)}</span>
          </div>
        </section>

        <section className="editor-panel panel">
          <div className="panel-header">
            <h2>Selection</h2>
          </div>

          <div className="selection-box">
            <div className="selection-values">
              <label>
                Start
                <input
                  type="range"
                  min={0}
                  max={effectiveDuration}
                  step={0.1}
                  value={selection.start}
                  onChange={(event) => updateSelectionStart(Number(event.target.value))}
                />
                <span>{formatTime(selection.start)}</span>
              </label>

              <label>
                End
                <input
                  type="range"
                  min={0}
                  max={effectiveDuration}
                  step={0.1}
                  value={selection.end}
                  onChange={(event) => updateSelectionEnd(Number(event.target.value))}
                />
                <span>{formatTime(selection.end)}</span>
              </label>
            </div>

            <div className="selection-tools">
              <button onClick={startSelectionFromPlayhead}>Set 2s range</button>
              <button
                onClick={() => setSelection({ start: clamp(playhead, 0, effectiveDuration), end: clamp(playhead + 5, 0, effectiveDuration) })}
              >
                Set 5s range
              </button>
            </div>
          </div>

          <div className="panel-header timeline-header">
            <h2>Timeline</h2>
          </div>

          <div className="timeline-wrap">
            <div className="timeline-ruler">
              <div
                className="playhead"
                style={{ left: `${(playhead / Math.max(effectiveDuration, 1)) * 100}%` }}
              />
              <div
                className="selection-highlight"
                style={{
                  left: `${(selection.start / Math.max(effectiveDuration, 1)) * 100}%`,
                  width: `${((selection.end - selection.start) / Math.max(effectiveDuration, 1)) * 100}%`,
                }}
              />

              {segments.map((segment) => (
                <div
                  key={segment.id}
                  className="voice-block"
                  style={{
                    left: `${(segment.start / Math.max(effectiveDuration, 1)) * 100}%`,
                    width: `${((segment.end - segment.start) / Math.max(effectiveDuration, 1)) * 100}%`,
                  }}
                  onClick={() => startSetFromSelection(segment)}
                >
                  <span>{segment.label}</span>
                  <small>{formatTime(segment.start)}–{formatTime(segment.end)}</small>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <section className="mix-panel panel">
        <div className="panel-header">
          <h2>Preview and mix</h2>
        </div>

        <div className="mix-controls">
          <label>
            Original audio
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={originalVolume}
              onChange={(event) => setOriginalVolume(Number(event.target.value))}
            />
            <span>{originalVolume.toFixed(2)}</span>
          </label>

          <label>
            Voice-over audio
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={voiceVolume}
              onChange={(event) => setVoiceVolume(Number(event.target.value))}
            />
            <span>{voiceVolume.toFixed(2)}</span>
          </label>
        </div>

        <div className="segment-list">
          {segments.length === 0 ? (
            <div className="empty-state small">No voice-over blocks yet. Record a line to create your first section.</div>
          ) : (
            segments.map((segment) => (
              <div className="segment-card" key={segment.id}>
                <div className="segment-meta">
                  <strong>{segment.label}</strong>
                  <span>
                    {formatTime(segment.start)} – {formatTime(segment.end)}
                  </span>
                </div>

                <div className="segment-actions">
                  <button onClick={() => startSetFromSelection(segment)}>Move to start</button>
                  <button onClick={() => trimSegment(segment.id, 'start', -0.5)}>-0.5s</button>
                  <button onClick={() => trimSegment(segment.id, 'start', 0.5)}>+0.5s</button>
                  <button onClick={() => trimSegment(segment.id, 'end', -0.5)}>-0.5s end</button>
                  <button onClick={() => trimSegment(segment.id, 'end', 0.5)}>+0.5s end</button>
                  <button onClick={() => rebuildSegmentRecording(segment.id)}>Re-record</button>
                  <button onClick={() => deleteSegment(segment.id)}>Delete</button>
                </div>

                <div className="segment-slider">
                  <label>
                    Volume
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.01}
                      value={segment.volume}
                      onChange={(event) => updateSegmentVolume(segment.id, Number(event.target.value))}
                    />
                    <span>{segment.volume.toFixed(2)}</span>
                  </label>
                </div>

                <audio
                  ref={(node) => {
                    if (node) audioRefs.current[segment.id] = node;
                  }}
                  src={segment.audioUrl}
                  preload="auto"
                />
              </div>
            ))
          )}
        </div>
      </section>

      <footer className="status-bar">
        <span>{statusMessage}</span>
      </footer>
    </div>
  );
};

export default App;

import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import * as Pitchfinder from 'pitchfinder';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Standard guitar tuning frequencies
const TUNING_FREQUENCIES = {
    'E2': 82.41,
    'A2': 110.00,
    'D3': 146.83,
    'G3': 196.00,
    'B3': 246.94,
    'E4': 329.63,
};

// Function to find the closest note and calculate the difference in cents
function getNoteAndCents(frequency) {
    if (frequency <= 0) {
        return { note: '--', cents: 0 };
    }

    const noteNames = Object.keys(TUNING_FREQUENCIES);
    let closestNote = noteNames[0];
    let minDiff = Infinity;

    for (const note of noteNames) {
        const diff = Math.abs(frequency - TUNING_FREQUENCIES[note]);
        if (diff < minDiff) {
            minDiff = diff;
            closestNote = note;
        }
    }

    const targetFreq = TUNING_FREQUENCIES[closestNote];
    const cents = Math.floor(1200 * Math.log2(frequency / targetFreq));

    return { note: closestNote, cents };
}

const GuitarTuner = () => {
    const [note, setNote] = useState('--');
    const [cents, setCents] = useState(0);
    const [status, setStatus] = useState('Waiting for microphone access...');
    const audioContextRef = useRef(null);
    const audioSourceRef = useRef(null);
    const analyserRef = useRef(null);
    const animationFrameRef = useRef(null);
    const smoothingRef = useRef(0.7);
    const pitchFinderRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const playContextRef = useRef(null);
    const [frequencyData, setFrequencyData] = useState([]);
    const chartDataRef = useRef([]);

    useEffect(() => {
        async function initializePitchDetection() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                setStatus('Microphone access granted.');

                audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
                const inputSampleRate = audioContextRef.current.sampleRate;
                audioSourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
                analyserRef.current = audioContextRef.current.createAnalyser();
                analyserRef.current.fftSize = 4096;
                audioSourceRef.current.connect(analyserRef.current);

                const bufferLength = analyserRef.current.fftSize;
                const buffer = new Float32Array(bufferLength);

                // Initialize Pitchfinder using the YIN algorithm
                pitchFinderRef.current = Pitchfinder.YIN({ sampleRate: inputSampleRate });

                function updatePitch() {
                    if (!analyserRef.current || !pitchFinderRef.current) return;

                    analyserRef.current.getFloatTimeDomainData(buffer);
                    const frequency = pitchFinderRef.current(buffer);

                    if (frequency !== null) {
                        let smoothedPitch = previousPitch === 0
                            ? frequency
                            : smoothingRef.current * previousPitch + (1 - smoothingRef.current) * frequency;
                        const { note: detectedNote, cents: detectedCents } = getNoteAndCents(smoothedPitch);
                        setNote(detectedNote);
                        setCents(detectedCents);

                        // Store data for the chart
                        const newDataPoint = {
                            time: Date.now(),
                            frequency: smoothedPitch,
                            note: detectedNote, // Include note for display in tooltip
                        };
                        chartDataRef.current = [...chartDataRef.current, newDataPoint];
                        setFrequencyData(chartDataRef.current);

                        previousPitch = smoothedPitch;
                    } else {
                        setNote('--');
                        setCents(0);
                        previousPitch = 0;
                        const newDataPoint = {
                            time: Date.now(),
                            frequency: 0,
                            note: '--',
                        };
                        chartDataRef.current = [...chartDataRef.current, newDataPoint];
                        setFrequencyData(chartDataRef.current);
                    }
                    animationFrameRef.current = requestAnimationFrame(updatePitch);
                }

                let previousPitch = 0;
                updatePitch();
            } catch (error) {
                console.error('Error accessing microphone:', error);
                setStatus(`Error accessing microphone: ${error.message}`);
            }
        }

        initializePitchDetection();

        return () => {
            // Cleanup on unmount
            if (audioSourceRef.current) {
                audioSourceRef.current.disconnect();
            }
            if (analyserRef.current) {
                analyserRef.current.disconnect();
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (playContextRef.current) {
                playContextRef.current.close();
            }
        };
    }, []);

    // Function to visually represent the cents deviation.
    function renderCentsIndicator() {
        const numBars = 21;
        const centerBarIndex = Math.floor(numBars / 2);
        const activeBarIndex = centerBarIndex + Math.floor(cents / 5);

        const bars = [];
        for (let i = 0; i < numBars; i++) {
            let barColor = 'gray';
            if (i === centerBarIndex) {
                barColor = 'white';
            } else if (i === activeBarIndex) {
                barColor = cents > 0 ? 'green' : 'red';
            }

            bars.push(
                <div
                    key={i}
                    style={{
                        width: '8px',
                        height: i === centerBarIndex ? '30px' : '20px',
                        backgroundColor: barColor,
                        margin: '2px',
                        borderRadius: '4px',
                        transition: 'background-color 0.1s ease',
                    }}
                />
            );
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                {bars}
            </div>
        );
    }

    // Function to play a specific frequency
    const playFrequency = (frequency) => {
        if (!playing) {
            playContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = playContextRef.current.createOscillator();
            const gainNode = playContextRef.current.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(playContextRef.current.destination);

            oscillator.frequency.setValueAtTime(frequency, playContextRef.current.currentTime);
            gainNode.gain.setValueAtTime(0.4, playContextRef.current.currentTime);

            oscillator.start(playContextRef.current.currentTime);
            setPlaying(true);

            setTimeout(() => {
                gainNode.gain.setValueAtTime(0, playContextRef.current.currentTime);
                setTimeout(() => {
                    oscillator.stop(playContextRef.current.currentTime);
                    setPlaying(false);
                    if (playContextRef.current) {
                        playContextRef.current.close();
                        playContextRef.current = null;
                    }
                }, 200);
            }, 1000);
        }
    };

    return (
        <div className="guitar-tuner">
            <p id="status">{status}</p>
            <div style={{ flexDirection: 'column', alignItems: 'center' }}>
                <p id="note" style={{ fontSize: '4em' }}>{note}</p>
                {renderCentsIndicator()}
                <p id="cents" style={{ marginTop: '10px' }}>{cents === 0 ? 'In Tune' : `${cents} cents`}</p>
                <button
                    onClick={() => playFrequency(TUNING_FREQUENCIES['E2'])}
                    style={{
                        marginTop: '20px', padding: '10px', backgroundColor: '#4CAF50', color: 'white',
                        borderRadius: '5px', cursor: 'pointer'
                    }}
                    disabled={playing}
                >
                    Play E2
                </button>
            </div>
            <ResponsiveContainer width="100%" height={300} style={{ marginTop: '20px' }}>
                <LineChart
                    data={frequencyData}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                        dataKey="time"
                        tickFormatter={(time) => new Date(time).toLocaleTimeString()}
                        domain={['dataMin', 'dataMax']} // Use dataMin and dataMax for dynamic domain
                        type="number"
                    />
                    <YAxis
                        dataKey="frequency"
                        domain={[0, 500]} // Adjust the domain as needed for guitar frequencies
                        tickCount={6}
                    />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#333', color: '#fff', borderColor: '#333' }}
                        labelStyle={{ color: '#fff' }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(value) => [value, 'Frequency (Hz)']}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="frequency" stroke="#8884d8" activeDot={{ r: 8 }} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

function App() {
    return (
        <div className="App">
            <header className="App-header">
                <h1>Guitar Tuner</h1>
                <GuitarTuner />
            </header>
        </div>
    );
}

export default App;


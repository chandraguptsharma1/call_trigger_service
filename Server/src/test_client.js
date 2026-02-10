// test_client.js
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8090/ws/agent');

ws.on('open', () => {
    console.log('Client connected to proxy.');
    // बातचीत शुरू करने के लिए मैसेज भेजें
    const message = {
        type: "conversation_initiation_metadata",
        conversation_initiation_metadata_event: {
            conversation_id: "test-conv-123",
            agent_output_audio_format: "pcm_16000",
            user_input_audio_format: "pcm_16000"
        }
    };
    ws.send(JSON.stringify(message));
});

ws.on('message', (data) => {
    console.log('Received from proxy:', JSON.parse(data));
});

ws.on('close', (code, reason) => {
    console.log(`Connection closed: ${code} ${reason}`);
});
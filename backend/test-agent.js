const fetch = require('node-fetch');

const API_URL = 'http://localhost:3000';

// Sample conversation
const sampleConversation = {
  messages: [
    { role: 'user', content: '안녕하세요! 저는 최근에 프로그래밍을 배우기 시작했어요.' },
    { role: 'assistant', content: '안녕하세요! 프로그래밍을 배우기 시작하신 것을 환영합니다. 어떤 언어부터 시작하고 계신가요?' },
    { role: 'user', content: 'Python으로 시작했는데, 좀 어려워요. 특히 리스트와 딕셔너리 개념이 헷갈려요.' },
    { role: 'assistant', content: 'Python은 좋은 선택이에요! 리스트와 딕셔너리는 중요한 자료구조입니다. 리스트는 순서가 있는 데이터 모음이고, 딕셔너리는 키-값 쌍으로 저장되는 데이터입니다.' },
    { role: 'user', content: '아! 이제 좀 이해가 되네요. 감사합니다!' }
  ],
  metadata: {
    source: 'test_script',
    topic: 'Python Programming Help'
  }
};

async function testAgent() {
  console.log('🧪 Testing AiDam Agent...\n');

  try {
    // Test 1: Health Check
    console.log('1️⃣ Health Check...');
    const healthResp = await fetch(`${API_URL}/health`);
    const health = await healthResp.json();
    console.log('✅ Server Status:', health);
    console.log();

    // Test 2: Process Conversation
    console.log('2️⃣ Processing Conversation...');
    console.log(`   Messages: ${sampleConversation.messages.length}`);
    const processResp = await fetch(`${API_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleConversation)
    });

    if (!processResp.ok) {
      throw new Error(`HTTP ${processResp.status}: ${await processResp.text()}`);
    }

    const result = await processResp.json();
    console.log('✅ Analysis Complete!');
    console.log(`   Report ID: ${result.reportId}`);
    console.log(`   Summary: ${result.analysis.summary}`);
    console.log(`   Topics: ${result.analysis.main_topics.join(', ')}`);
    console.log(`   Sentiment: ${result.analysis.sentiment}`);
    console.log();

    // Test 3: List Reports
    console.log('3️⃣ Fetching Reports List...');
    const reportsResp = await fetch(`${API_URL}/reports`);
    const reports = await reportsResp.json();
    console.log(`✅ Found ${reports.reports.length} reports`);
    console.log();

    // Test 4: Get Specific Report
    if (result.reportId) {
      console.log('4️⃣ Fetching Specific Report...');
      const reportResp = await fetch(`${API_URL}/reports/${result.reportId}`);
      const reportData = await reportResp.json();
      console.log('✅ Report Retrieved');
      console.log(`   Created: ${reportData.report.created_at}`);
      console.log(`   Content Length: ${reportData.report.content.length} chars`);
      console.log();

      console.log('📄 Report Preview:');
      console.log('─'.repeat(60));
      console.log(reportData.report.content.substring(0, 500) + '...');
      console.log('─'.repeat(60));
    }

    console.log('\n✨ All tests passed!');
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  }
}

// Run tests
testAgent();

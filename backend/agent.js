require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// LLM 제공자 설정 (ollama 또는 openai)
// LLM Provider: 'ollama' for local Ollama server, 'openai' for OpenAI API
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';

// Ollama 로컬 서버 설정
// Ollama local server configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:20b';

// OpenAI API 설정
// OpenAI API configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// 서버 포트
// Server port
const PORT = process.env.PORT || 3000;

// Reports storage directory
const REPORTS_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// Health check
// 서버 상태 확인
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    mode: 'agent',
    provider: LLM_PROVIDER,
    model: LLM_PROVIDER === 'openai' ? OPENAI_MODEL : OLLAMA_MODEL,
    host: LLM_PROVIDER === 'openai' ? 'OpenAI API' : OLLAMA_HOST
  });
});

// Get available models
app.get('/models', async (req, res) => {
  try {
    if (LOCAL_LLM_PROVIDER === 'ollama') {
      const resp = await fetch(`${OLLAMA_HOST.replace(/\/$/, '')}/api/tags`);
      if (!resp.ok) throw new Error(`Ollama error ${resp.status}`);
      const data = await resp.json();
      
      const models = (data.models || []).map(m => ({
        id: m.name,
        name: m.name,
        size: m.size,
        modified: m.modified_at
      }));
      
      res.json({ models });
    } else {
      res.json({ models: [] });
    }
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// Analyze chat conversation
app.post('/analyze', async (req, res) => {
  try {
    const { messages, metadata } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Format conversation for analysis
    const conversationText = messages.map((m, idx) => {
      return `[${idx + 1}] ${m.role.toUpperCase()}: ${m.content}`;
    }).join('\n\n');

    // Create analysis prompt
    const analysisPrompt = `다음 대화를 분석하고 상세한 분석 결과를 JSON 형식으로 제공하세요.

대화 내용:
${conversationText}

다음 JSON 구조로 분석 결과를 작성하세요 (모든 텍스트는 한글로):
{
  "summary": "전체 대화에 대한 간략한 요약 (2-3문장)",
  "main_topics": ["주제1", "주제2", ...],
  "key_points": ["핵심 포인트1", "핵심 포인트2", ...],
  "sentiment": "긍정적/부정적/중립적/복합적",
  "participant_roles": {
    "user": "사용자의 행동과 의도 설명",
    "assistant": "상담사의 행동과 응답 방식 설명"
  },
  "conversation_flow": "대화가 어떻게 전개되었는지 설명",
  "insights": ["통찰1", "통찰2", ...],
  "statistics": {
    "total_messages": 숫자,
    "user_messages": 숫자,
    "assistant_messages": 숫자,
    "average_message_length": 숫자
  }
}

반드시 유효한 JSON만 응답하고, 추가 텍스트는 포함하지 마세요.`;

    // LLM을 호출하여 분석 수행
    // Call LLM for analysis
    const analysisResult = await callLLM(analysisPrompt);
    
    // JSON 응답 파싱
    let analysis;
    try {
      // Extract JSON from response
      const jsonMatch = analysisResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse LLM response as JSON:', parseError);
      // Fallback: create basic analysis
      analysis = {
        summary: analysisResult.substring(0, 200),
        main_topics: ['conversation analysis'],
        key_points: ['Analysis completed'],
        sentiment: 'neutral',
        participant_roles: {
          user: 'User participant',
          assistant: 'AI assistant'
        },
        conversation_flow: 'Conversation analyzed',
        insights: ['See full response for details'],
        statistics: {
          total_messages: messages.length,
          user_messages: messages.filter(m => m.role === 'user').length,
          assistant_messages: messages.filter(m => m.role === 'assistant').length,
          average_message_length: Math.round(messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length)
        }
      };
    }

    // 분석 메타데이터 추가
    // Add analysis metadata
    analysis.metadata = {
      analyzed_at: new Date().toISOString(),
      provider: LLM_PROVIDER,
      model_used: LLM_PROVIDER === 'openai' ? OPENAI_MODEL : OLLAMA_MODEL,
      ...metadata
    };

    res.json({ success: true, analysis });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

// Generate report from analysis
// 분석 결과로부터 보고서 생성
app.post('/generate-report', async (req, res) => {
  try {
    const { analysis, format = 'markdown' } = req.body;
    
    if (!analysis) {
      return res.status(400).json({ error: 'analysis object is required' });
    }

    const reportPrompt = `대화 분석 데이터를 기반으로 전문적이고 포괄적인 보고서를 작성하세요.

분석 데이터:
${JSON.stringify(analysis, null, 2)}

다음 섹션으로 구성된 상세한 보고서를 한글 Markdown 형식으로 작성하세요:
1. 요약
2. 대화 개요
3. 주요 주제 및 테마
4. 상세 분석
5. 참여자 행동 분석
6. 인사이트 및 관찰 사항
7. 통계
8. 권장 사항 (해당되는 경우)

보고서는 명확하고 전문적이며 실용적이어야 합니다. 제목, 목록, 표, 강조 등 적절한 Markdown 형식을 사용하세요.`;

    // LLM을 호출하여 보고서 생성
    // Call LLM to generate report
    const reportContent = await callLLM(reportPrompt);

    // 보고서 저장
    // Save report
    const reportId = `report_${Date.now()}`;
    const reportData = {
      id: reportId,
      created_at: new Date().toISOString(),
      analysis,
      content: reportContent,
      format
    };

    const reportPath = path.join(REPORTS_DIR, `${reportId}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));

    res.json({ 
      success: true, 
      report: {
        id: reportId,
        content: reportContent,
        created_at: reportData.created_at
      }
    });
  } catch (err) {
    console.error('Report generation error:', err);
    res.status(500).json({ error: err.message || 'Report generation failed' });
  }
});

// Get list of reports
app.get('/reports', (req, res) => {
  try {
    const files = fs.readdirSync(REPORTS_DIR);
    const reports = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8'));
        return {
          id: data.id,
          created_at: data.created_at,
          summary: data.analysis?.summary || 'No summary',
          topics: data.analysis?.main_topics || []
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ reports });
  } catch (err) {
    console.error('Error fetching reports:', err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Get specific report
app.get('/reports/:id', (req, res) => {
  try {
    const reportPath = path.join(REPORTS_DIR, `${req.params.id}.json`);
    
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    res.json({ success: true, report: data });
  } catch (err) {
    console.error('Error fetching report:', err);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// Delete report
app.delete('/reports/:id', (req, res) => {
  try {
    const reportPath = path.join(REPORTS_DIR, `${req.params.id}.json`);
    
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    fs.unlinkSync(reportPath);
    res.json({ success: true, message: 'Report deleted' });
  } catch (err) {
    console.error('Error deleting report:', err);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// Process with streaming progress updates
app.post('/process', async (req, res) => {
  try {
    const { messages, metadata } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Set up SSE headers for streaming progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = (step, message, data = null) => {
      res.write(`data: ${JSON.stringify({ step, message, data })}\n\n`);
    };

    console.log(`Processing conversation with ${messages.length} messages...`);
    const userMsgCount = messages.filter(m => m.role === 'user').length;
    const assistantMsgCount = messages.filter(m => m.role === 'assistant').length;
    
    sendProgress(1, `대화 내용을 준비하고 있습니다... (고객 ${userMsgCount}개, 상담사 ${assistantMsgCount}개 메시지)`);

    // Step 1: Analyze
    const conversationText = messages.map((m, idx) => {
      return `[${idx + 1}] ${m.role.toUpperCase()}: ${m.content}`;
    }).join('\n\n');

    const analysisPrompt = `다음 대화를 분석하고 상세한 분석 결과를 JSON 형식으로 제공하세요.

대화 내용:
${conversationText}

다음 JSON 구조로 분석 결과를 작성하세요 (모든 텍스트는 한글로):
{
  "summary": "전체 대화에 대한 간략한 요약 (2-3문장)",
  "main_topics": ["주제1", "주제2", ...],
  "key_points": ["핵심 포인트1", "핵심 포인트2", ...],
  "sentiment": "긍정적/부정적/중립적/복합적",
  "participant_roles": {
    "user": "사용자의 행동과 의도 설명",
    "assistant": "상담사의 행동과 응답 방식 설명"
  },
  "conversation_flow": "대화가 어떻게 전개되었는지 설명",
  "insights": ["통찰1", "통찰2", ...],
  "statistics": {
    "total_messages": ${messages.length},
    "user_messages": ${messages.filter(m => m.role === 'user').length},
    "assistant_messages": ${messages.filter(m => m.role === 'assistant').length},
    "average_message_length": ${Math.round(messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length)}
  }
}

반드시 유효한 JSON만 응답하고, 추가 텍스트는 포함하지 마세요.`;

    console.log('Step 2: Analyzing conversation...');
    sendProgress(2, `AI가 대화를 분석하고 있습니다... (${LLM_PROVIDER === 'openai' ? 'OpenAI' : 'Ollama'} ${LLM_PROVIDER === 'openai' ? OPENAI_MODEL : OLLAMA_MODEL})`);
    
    // LLM을 호출하여 대화 분석
    // Call LLM to analyze conversation
    const analysisResult = await callLLM(analysisPrompt);
    
    let analysis;
    try {
      const jsonMatch = analysisResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse analysis:', parseError);
      analysis = {
        summary: 'Conversation analyzed',
        main_topics: ['General conversation'],
        key_points: ['Analysis completed'],
        sentiment: 'neutral',
        participant_roles: {
          user: 'User participant',
          assistant: 'AI assistant'
        },
        conversation_flow: 'Standard conversation flow',
        insights: ['See details below'],
        statistics: {
          total_messages: messages.length,
          user_messages: messages.filter(m => m.role === 'user').length,
          assistant_messages: messages.filter(m => m.role === 'assistant').length,
          average_message_length: Math.round(messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length)
        }
      };
    }

    // 분석 메타데이터 추가
    // Add analysis metadata
    analysis.metadata = {
      analyzed_at: new Date().toISOString(),
      provider: LLM_PROVIDER,
      model_used: LLM_PROVIDER === 'openai' ? OPENAI_MODEL : OLLAMA_MODEL,
      ...metadata
    };

    console.log('Analysis completed successfully');
    sendProgress(3, `분석 완료! 주요 주제: ${analysis.main_topics?.slice(0, 2).join(', ') || '대화 분석'}... 이제 보고서를 생성합니다.`, { analysis });

    // Step 3: Generate Report
    // 3단계: 보고서 생성
    console.log('Step 3: Generating report...');
    const reportPrompt = `대화 분석 데이터를 기반으로 전문적이고 포괄적인 보고서를 작성하세요.

분석 데이터:
${JSON.stringify(analysis, null, 2)}

다음 섹션으로 구성된 상세한 보고서를 한글 Markdown 형식으로 작성하세요:
1. 요약
2. 대화 개요
3. 주요 주제 및 테마
4. 상세 분석
5. 참여자 행동 분석
6. 인사이트 및 관찰 사항
7. 통계
8. 권장 사항 (해당되는 경우)

보고서는 명확하고 전문적이며 실용적이어야 합니다. 제목, 목록, 표, 강조 등 적절한 Markdown 형식을 사용하세요.`;

    // LLM을 호출하여 보고서 생성
    // Call LLM to generate report
    const reportContent = await callLLM(reportPrompt);
    
    console.log('Report generated successfully');
    sendProgress(4, '보고서 생성 완료! 데이터베이스에 저장하고 있습니다...');

    // 보고서 저장
    // Save report
    const reportId = `report_${Date.now()}`;
    const reportData = {
      id: reportId,
      created_at: new Date().toISOString(),
      analysis,
      content: reportContent,
      format: 'markdown',
      messages: messages // Store original messages
    };

    const reportPath = path.join(REPORTS_DIR, `${reportId}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));

    console.log(`Report saved successfully: ${reportId}`);

    // Send final result
    sendProgress(5, `✅ 보고서 생성 완료! (ID: ${reportId.substring(7, 17)}...)`, {
      success: true,
      reportId,
      analysis,
      report: reportContent,
      created_at: reportData.created_at
    });

    res.end();
  } catch (err) {
    console.error('Process error:', err);
    
    let errorMessage = '보고서 생성 중 오류가 발생했습니다.';
    
    if (err.message.includes('fetch')) {
      errorMessage = 'LLM 서버에 연결할 수 없습니다. Ollama 또는 OpenAI 설정을 확인해주세요.';
    } else if (err.message.includes('timeout')) {
      errorMessage = '요청 시간이 초과되었습니다. 다시 시도해주세요.';
    } else if (err.message.includes('JSON')) {
      errorMessage = 'LLM 응답을 처리하는 중 오류가 발생했습니다.';
    } else {
      errorMessage = err.message || errorMessage;
    }
    
    res.write(`data: ${JSON.stringify({ 
      step: -1, 
      message: 'Error', 
      error: errorMessage,
      details: err.stack 
    })}\n\n`);
    res.end();
  }
});

/**
 * LLM 호출 헬퍼 함수
 * Call LLM helper function
 * 
 * @param {string} prompt - 전송할 프롬프트 / Prompt to send
 * @param {string} model - 사용할 모델 (선택사항) / Model to use (optional)
 * @returns {Promise<string>} LLM 응답 / LLM response
 */
async function callLLM(prompt, model = null) {
  try {
    // OpenAI API 사용
    // Use OpenAI API
    if (LLM_PROVIDER === 'openai') {
      if (!OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY가 설정되지 않았습니다. 환경변수를 확인해주세요.');
      }

      console.log(`Calling OpenAI API with model: ${model || OPENAI_MODEL}`);
      
      const resp = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: model || OPENAI_MODEL,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 4096
        })
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        console.error('OpenAI API error:', errorText);
        throw new Error(`OpenAI API 오류 (${resp.status}): ${errorText.substring(0, 200)}`);
      }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      if (!content) {
        throw new Error('OpenAI API로부터 응답을 받지 못했습니다.');
      }
      
      return content;
    } 
    // Ollama 로컬 서버 사용
    // Use Ollama local server
    else {
      console.log(`Calling Ollama with model: ${model || OLLAMA_MODEL}`);
      
      const resp = await fetch(`${OLLAMA_HOST.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || OLLAMA_MODEL,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 4096
          }
        })
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        console.error('Ollama error:', errorText);
        
        if (resp.status === 404) {
          throw new Error(`Ollama 모델 '${model || OLLAMA_MODEL}'을 찾을 수 없습니다. 모델이 설치되어 있는지 확인해주세요.`);
        }
        
        throw new Error(`Ollama 오류 (${resp.status}): ${errorText.substring(0, 200)}`);
      }

      const data = await resp.json();
      const content = data.response || '';
      
      if (!content) {
        throw new Error('Ollama로부터 응답을 받지 못했습니다.');
      }
      
      return content;
    }
  } catch (err) {
    console.error('LLM call error:', err);
    
    // Provide more user-friendly error messages
    if (err.code === 'ECONNREFUSED') {
      throw new Error(`LLM 서버에 연결할 수 없습니다. ${LLM_PROVIDER === 'openai' ? 'OpenAI API' : `Ollama (${OLLAMA_HOST})`}가 실행 중인지 확인해주세요.`);
    } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
      throw new Error('요청 시간이 초과되었습니다. 네트워크 연결을 확인하거나 다시 시도해주세요.');
    }
    
    throw err;
  }
}

// 서버 시작
// Start server
app.listen(PORT, () => {
  console.log(`\n=== Agent Backend Started ===`);
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Mode: Agent (Conversation Analysis & Report Generation)`);
  console.log(`LLM Provider: ${LLM_PROVIDER}`);
  
  if (LLM_PROVIDER === 'openai') {
    console.log(`OpenAI Model: ${OPENAI_MODEL}`);
    console.log(`API Key: ${OPENAI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  } else {
    console.log(`Ollama Host: ${OLLAMA_HOST}`);
    console.log(`Ollama Model: ${OLLAMA_MODEL}`);
  }
  
  console.log(`Reports Directory: ${REPORTS_DIR}`);
  console.log(`=============================\n`);
});

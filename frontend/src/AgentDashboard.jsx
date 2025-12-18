import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import RAGAssistant from './RAGAssistant'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

const UPSELL_AGENT_URL = 'http://localhost:8008'

export default function AgentDashboard() {
  const [view, setView] = useState('main') // 'main', 'history', 'samples'
  const [messages, setMessages] = useState([])
  const [processing, setProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState(0)
  const [processingMessage, setProcessingMessage] = useState('')
  const [currentReport, setCurrentReport] = useState(null)
  const [reports, setReports] = useState([])
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [autoAnalyze, setAutoAnalyze] = useState(true)
  const [callStatus, setCallStatus] = useState('active') // 'idle', 'ringing', 'active', 'ended'
  const [currentCallId, setCurrentCallId] = useState(null) // 현재 통화 ID (고객 변경 감지용)
  const [currentPhoneNumber, setCurrentPhoneNumber] = useState('010-1111-2222')
  const [rightPanelTab, setRightPanelTab] = useState('intent') // 'intent', 'report'
  const [regenerating, setRegenerating] = useState(false)

  // 고객 정보 (Backend Integration)
  const [customerInfo, setCustomerInfo] = useState(null)

  // 고객 메시지 클릭 시 스크립트 생성 트리거
  const [triggerMessage, setTriggerMessage] = useState(null)

  // 추천 요금제 (AI가 분석해서 제공)
  const [recommendedPlans, setRecommendedPlans] = useState([])

  // AI 분석/사고 과정
  const [aiReasoning, setAiReasoning] = useState([])
  const [isAnalyzingIntent, setIsAnalyzingIntent] = useState(false)

  // RAG Scripts State (Lifted from RAGAssistant)
  const [ragScripts, setRagScripts] = useState([])
  const [isRagCleared, setIsRagCleared] = useState(false) // 초기화 상태 추적

  // 선택된 요금제에 대한 추천 스크립트
  const [planScript, setPlanScript] = useState('')
  const [scriptLoading, setScriptLoading] = useState(false)

  // 고객 의중 (AI 분석 결과)
  const [customerIntent, setCustomerIntent] = useState('대화 내용 분석 대기 중...')

  // [NEW] Upsell Analysis History & Selection
  const [upsellHistory, setUpsellHistory] = useState({}); // { messageId: AnalysisResult }
  const [selectedAnalysisId, setSelectedAnalysisId] = useState(null);
  const [analyzingMessages, setAnalyzingMessages] = useState(new Set()); // [NEW] Track messages being analyzed

  const [sampleList] = useState([
    { id: 0, title: '인터넷 장애 - 긴급 문의' },
    { id: 1, title: '통화품질 불량 - 유심 교체' },
    { id: 2, title: '요금제 변경 - 데이터 절약' },
    { id: 3, title: '청구서 이상 - 부가서비스 항의' },
    { id: 4, title: '기기 변경 - 아이폰 구매' },
    { id: 5, title: '데이터 차단 - 추가 구매' },
    { id: 6, title: '해외 로밍 - 일본 여행' },
    { id: 7, title: '명의 도용 오해 - 미납 발견' },
    { id: 8, title: '5G 커버리지 불만' },
    { id: 9, title: '어르신 요금제 - 효도 상담' }
  ])

  // [NEW] Helper to update Right Panel State
  const updateRightPanel = (result) => {
    // Update Intent logic
    if (result.customer_intent) {
      setCustomerIntent(result.customer_intent);
    }

    // Update Reasoning logic
    if (result.reasoning_steps && result.reasoning_steps.length > 0) {
      setAiReasoning(result.reasoning_steps);
    } else if (result.upsell_reason) {
      setAiReasoning([result.upsell_reason]);
    } else if (result.intent_description) {
      setAiReasoning([result.intent_description]);
    }

    // Update Recommended Plans logic
    if (result.recommended_plans && result.recommended_plans.length > 0) {
      const plans = result.recommended_plans.map((plan, idx) => ({
        id: idx,
        name: plan.plan_name,
        price: plan.monthly_fee.toLocaleString(),
        rawPrice: plan.monthly_fee,
        data: plan.data_limit,
        selected: false
      }));
      setRecommendedPlans(plans);
    }
  }

  // 고객 메시지 클릭 핸들러
  const handleCustomerMessageClick = (messageContent) => {
    setTriggerMessage({ content: messageContent, timestamp: Date.now() })
  }

  // [NEW] Handle Analysis Tag Click
  const handleAnalysisTagClick = (messageId, e) => {
    e.stopPropagation(); // prevent bubble click

    if (selectedAnalysisId === messageId) {
      // Deselect (Return to live mode)
      setSelectedAnalysisId(null);
      return;
    }

    const analysis = upsellHistory[messageId];
    if (analysis) {
      setSelectedAnalysisId(messageId);
      updateRightPanel(analysis);
      setRightPanelTab('intent');
    }
  };

  // Call Status Polling Function
  const pollCallStatus = async () => {
    try {
      const resp = await fetch(`${API_URL}/active-call`)
      const data = await resp.json()
      
      // 통화가 있는 경우 (활성 또는 종료 직후)
      if (data.call) {
        const wasInactive = callStatus === 'idle' || callStatus === 'ended'
        
        // 통화 상태 업데이트
        if (data.active) {
          setCallStatus('active')
        }

        // 새로운 통화가 시작되면 고객 분석 탭으로 전환 및 RAG 초기화
        if (wasInactive && data.active) {
          setRightPanelTab('intent')
          setRagScripts([]) // 새 통화 시 RAG 결과 초기화
          setIsRagCleared(false) // 새 통화 시작 시 초기화 상태 해제

          // [NEW] Upsell Analysis Reset
          setCustomerIntent('대화 내용 분석 대기 중...')
          setAiReasoning([])
          setRecommendedPlans([])
          setSelectedAnalysisId(null)
          setUpsellHistory({})
          setAnalyzingMessages(new Set())
          
          // 새 통화 시작 시 자동 스크롤 활성화
          shouldAutoScrollRef.current = true
        }

        setCustomerInfo({
          name: data.call.customer['이름'] || 'Unknown',
          phone: data.call.customer['번호'],
          plan: data.call.customer['요금제'] || 'Unknown',
          age: data.call.customer['나이'],
          usage: {
            prev: data.call.customer['전월 데이터'],
            curr: data.call.customer['현월 데이터']
          }
        })
        setCurrentPhoneNumber(data.call.customer['번호'])
        // 초기화 상태가 아닐 때만 메시지 복원
        if (view === 'main' && data.call.messages && !isRagCleared) {
          const newMessages = data.call.messages.map(m => ({
            role: m.role,
            content: m.content,
            keywords: m.keywords,
            messageId: m.messageId
          }));
          setMessages(newMessages);

          // [NEW] Mark user messages as analyzing if they don't have analysis yet
          newMessages.forEach(msg => {
            if (msg.role === 'user' && msg.messageId && !upsellHistory[msg.messageId]) {
              setAnalyzingMessages(prev => new Set(prev).add(msg.messageId));
            }
          });
        }

        // Backend-driven RAG Results Update (로컬 스크립트 보존, 초기화 상태가 아닐 때만)
        if (data.call.ragResults && data.call.ragResults.length > 0 && !isRagCleared) {
          // 로컬에서 생성된 스크립트 보존 (isLocal: true인 항목)
          const localScripts = ragScripts.filter(s => s.isLocal)
          // 백엔드 스크립트 + 로컬 스크립트 병합
          const mergedScripts = [...data.call.ragResults, ...localScripts]
          // 중복 방지 (ID 기준)
          const uniqueScripts = mergedScripts.filter((script, index, self) =>
            index === self.findIndex(s => s.id === script.id)
          )
          if (JSON.stringify(uniqueScripts.map(s => s.id)) !== JSON.stringify(ragScripts.map(s => s.id))) {
            setRagScripts(uniqueScripts)
          }
        }

        // [NEW] Process Upsell Analysis History
        if (data.call.upsellAnalysisHistory) {
          const historyMap = {};
          data.call.upsellAnalysisHistory.forEach(item => {
            if (item.messageId) historyMap[item.messageId] = item;
          });
          setUpsellHistory(historyMap);
          
          // 분석 완료된 메시지를 analyzingMessages에서 제거
          setAnalyzingMessages(prev => {
            const updated = new Set(prev);
            Object.keys(historyMap).forEach(messageId => {
              updated.delete(messageId);
            });
            return updated;
          });
        }

        // Backend-driven Upsell Analysis Update (Latest)
        // [MODIFIED] Do NOT automatically update right panel even if selectedAnalysisId is null.
        // User must click the tag to see the analysis.
        /* 
        if (data.call.upsellAnalysis && selectedAnalysisId === null) {
          const result = data.call.upsellAnalysis;
          updateRightPanel(result);
        } 
        */
        
        // 통화 종료 감지 (active: false이지만 call 데이터는 있음)
        if (!data.active && callStatus === 'active') {
          setCallStatus('ended')
          // Auto-navigate to Report Tab
          setRightPanelTab('report')
        }
      } else if (!data.call && callStatus === 'active') {
        // Call 데이터도 없고 이전에 활성이었던 경우
        setCallStatus('ended')
        setRightPanelTab('report')
      }
    } catch (err) {
      console.error('Failed to poll call status:', err)
    }
  }

  // Polling Effect
  useEffect(() => {
    const interval = setInterval(pollCallStatus, 2000)
    return () => clearInterval(interval)
  }, [callStatus, selectedAnalysisId, upsellHistory, view, isRagCleared])

  // Auto-navigate Effect when manually ending call
  useEffect(() => {
    if (callStatus === 'ended') {
      setRightPanelTab('report')
    }
  }, [callStatus])

  // Auto-scroll to bottom of chat (only if already at bottom)
  const chatContainerRef = useRef(null)
  const shouldAutoScrollRef = useRef(true) // Track if user is at bottom

  // Check if user is near bottom (within 50px threshold)
  const checkIfAtBottom = () => {
    const container = chatContainerRef.current
    if (!container) return true
    
    const threshold = 50
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceFromBottom < threshold
  }

  // Handle scroll events to track user position
  const handleScroll = () => {
    shouldAutoScrollRef.current = checkIfAtBottom()
  }

  useEffect(() => {
    const container = chatContainerRef.current
    if (!container) return

    // Only auto-scroll if user was at bottom before update
    if (shouldAutoScrollRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages])


  useEffect(() => {
    loadReports()
  }, [])

  // 대화가 업데이트될 때마다 의중 분석 (User 메시지인 경우)
  // [REMOVED] Client-side trigger logic replaced by Backend-driven architecture
  // useEffect(() => { ... }, [messages])

  // AI 의중 분석 (Upsell Agent 연결)
  // [REMOVED] Client-side trigger logic replaced by Backend-driven architecture
  // const analyzeIntent = async () => { ... }

  const loadReports = async (phone = null) => {
    try {
      const url = phone ? `${API_URL}/reports?phone=${phone}` : `${API_URL}/reports`
      const resp = await fetch(url)
      const data = await resp.json()
      setReports(data.reports || [])
    } catch (err) {
      console.error('Failed to load reports:', err)
    }
  }

  const parseMessages = (text) => {
    const lines = text.trim().split('\n')
    const msgs = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const match = trimmed.match(/^(user|assistant|system):\s*(.+)$/i)
      if (match) {
        msgs.push({
          role: match[1].toLowerCase(),
          content: match[2].trim()
        })
      } else if (msgs.length > 0) {
        msgs[msgs.length - 1].content += '\n' + trimmed
      } else {
        msgs.push({
          role: 'user',
          content: trimmed
        })
      }
    }

    return msgs
  }

  const handleEndCall = async () => {
    try {
      await fetch(`${API_URL}/call/end`, { method: 'POST' })
      setCallStatus('ended')
    } catch (err) {
      console.error('Failed to end call:', err)
    }
  }

  /* Simulation Logic */
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationMenuOpen, setSimulationMenuOpen] = useState(false)

  const simulateConversation = async (sampleId) => {
    setSimulationMenuOpen(false)
    setIsSimulating(true)

    try {
      // 1. Load Sample Data via Frontend fetch (client-side)
      const resp = await fetch(`/sample-conversations/conversation${sampleId}.json`)
      let sampleData = await resp.json()

      // Support both Array (legacy) and Object (new) formats
      let sampleMessages = []
      let phone = '010-1234-5678' // Default fallback

      if (Array.isArray(sampleData)) {
        sampleMessages = sampleData
      } else {
        sampleMessages = sampleData.messages
        if (sampleData.phoneNumber) phone = sampleData.phoneNumber
      }

      // 2. Start Call via API
      const startResp = await fetch(`${API_URL}/api/stt/call-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: `sim-${Date.now()}`,
          phoneNumber: phone
        })
      })

      if (!startResp.ok) throw new Error('Call start failed')

      // 새로운 통화 시작 시 고객 분석 탭으로 전환
      setRightPanelTab('intent')
      
      // 시뮬레이션 시작 시 자동 스크롤 활성화
      shouldAutoScrollRef.current = true

      // Refresh UI immediately to show Customer Info
      await pollCallStatus()

      // 3. Send Lines Sequentially
      for (const msg of sampleMessages) {
        // Delay 1 second for simulation effect
        await new Promise(r => setTimeout(r, 1000))

        const response = await fetch(`${API_URL}/api/stt/line`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId: 'current', // Backend handles current active call
            speaker: msg.role === 'user' ? 'customer' : 'agent',
            text: msg.content,
            keywords: msg.keywords || []
          })
        })
      }

      // 4. End Call Automatically after simulation
      console.log('[Simulation] All messages sent, ending call...')
      await new Promise(r => setTimeout(r, 1500)) // 마지막 메시지 처리 대기

      const endResp = await fetch(`${API_URL}/call/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (endResp.ok) {
        console.log('[Simulation] Call ended successfully')
        // 통화 종료 후 상태 업데이트
        await pollCallStatus()
      }

    } catch (err) {
      console.error('Simulation failed:', err)
      alert(`시뮬레이션 중 오류가 발생했습니다: ${err.message}`)
    } finally {
      setIsSimulating(false)
      console.log(`[Simulation] Completed - ${sampleMessages.length} messages sent`)
    }
  }

  // const loadSampleConversation = ... (Removed in favor of simulateConversation)

  const showSampleList = () => {
    setView('samples')
  }

  const handleProcess = async () => {
    if (messages.length === 0) {
      alert('분석할 대화가 없습니다. 먼저 대화를 불러와주세요.')
      return
    }

    setProcessing(true)
    setRegenerating(currentReport !== null)
    setProcessingStep(0)
    setProcessingMessage('보고서 생성을 준비하고 있습니다...')
    setRightPanelTab('report')

    try {
      // 재생성 카운트 계산
      const regenerationCount = currentReport?.regeneration_count || 0
      const isRegeneration = currentReport !== null

      const response = await fetch(`${API_URL}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          metadata: {
            source: isRegeneration ? 'regeneration' : 'auto_analysis',
            uploaded_at: new Date().toISOString(),
            original_report_id: isRegeneration ? currentReport.reportId : null,
            regeneration_count: isRegeneration ? regenerationCount + 1 : 0,
            // Capture UI Snapshot for Report Detail View
            ui_snapshot: {
              recommendedPlans: recommendedPlans,
              aiReasoning: aiReasoning,
              planScript: planScript,
              customerIntent: customerIntent,
              // Only capture selection state
              selectedPlanId: recommendedPlans.find(p => p.selected)?.id || null,
              // RAG Scripts
              ragScripts: ragScripts.map(script => ({
                id: script.id,
                title: script.title,
                content: script.content,
                sources: script.sources?.map(s => ({
                  page: s.page,
                  content: s.content
                })),
                isAutoGenerated: script.isAutoGenerated,
                isManual: script.isManual,
                isError: script.isError
              }))
            }
          }
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `서버 오류 (${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6))

              if (data.step === -1) {
                throw new Error(data.error || '보고서 생성 중 오류가 발생했습니다.')
              }

              setProcessingStep(data.step)
              setProcessingMessage(data.message)

              if (data.step === 5 && data.data) {
                const result = data.data
                setCurrentReport({
                  ...result,
                  regeneration_count: result.regeneration_count || 0
                })
                setSelectedReportId(result.reportId)
                await loadReports()
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError)
            }
          }
        }
      }

      setProcessing(false)
      setRegenerating(false)
    } catch (err) {
      console.error('Process error:', err)
      const errorMessage = err.message || '보고서 생성 중 오류가 발생했습니다.'
      alert(`❌ 오류 발생\n\n${errorMessage}\n\n백엔드 서버가 실행 중인지 확인해주세요.`)
      setProcessing(false)
      setRegenerating(false)
      setProcessingStep(0)
      setProcessingMessage('')
    }
  }

  const viewReport = async (reportId) => {
    try {
      const resp = await fetch(`${API_URL}/reports/${reportId}`)
      const data = await resp.json()

      if (data.success) {
        setCurrentReport({
          reportId: data.report.id,
          analysis: data.report.analysis,
          report: data.report.content,
          created_at: data.report.created_at,
          // Load Snapshot
          ui_snapshot: data.report.ui_snapshot,
          customer_phone: data.report.customer_phone,
          regeneration_count: data.report.regeneration_count || 0
        })
        setMessages(data.report.messages || [])
        setSelectedReportId(reportId)

        // Decide View based on context
        // If clicking from History list, go to 'report_detail'
        // If just generated, stay in 'main' (or move to detail if preferred? Stick to main for now)
        if (view === 'history') {
          setView('report_detail')
        } else {
          setView('main')
          setRightPanelTab('report')
        }
      }
    } catch (err) {
      console.error('Failed to load report:', err)
      alert('Failed to load report')
    }
  }

  const deleteReport = async (reportId, e) => {
    e.stopPropagation()

    if (!confirm('Delete this report?')) return

    try {
      const resp = await fetch(`${API_URL}/reports/${reportId}`, {
        method: 'DELETE'
      })

      if (resp.ok) {
        await loadReports()
        if (currentReport && currentReport.reportId === reportId) {
          setCurrentReport(null)
          setMessages([])
          setSelectedReportId(null)
        }
      }
    } catch (err) {
      console.error('Failed to delete report:', err)
      alert('Failed to delete report')
    }
  }

  const clearCurrentConversation = () => {
    setMessages([])
    setCurrentReport(null)
    setSelectedReportId(null)
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target.result

        try {
          const json = JSON.parse(text)
          if (Array.isArray(json) && json[0]?.role && json[0]?.content) {
            setMessages(json)
            return
          }
        } catch { }

        const parsed = parseMessages(text)
        if (parsed.length > 0) {
          setMessages(parsed)
        }
      } catch (err) {
        alert('Failed to read file')
      }
    }
    reader.readAsText(file)
  }

  const exportMessages = () => {
    const dataStr = JSON.stringify(messages, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `conversation_${Date.now()}.json`
    link.click()
  }

  // Incoming Call Simulation (Dev Tool) - Now opens menu
  const toggleSimulationMenu = () => {
    setSimulationMenuOpen(!simulationMenuOpen)
  }

  // 요금제 선택 핸들러
  const handlePlanSelect = async (planId) => {
    // 선택 상태 업데이트
    setRecommendedPlans(prev => prev.map(plan => ({
      ...plan,
      selected: plan.id === planId
    })))

    const selectedPlan = recommendedPlans.find(p => p.id === planId)
    if (!selectedPlan) return

    // 스크립트 생성 요청
    setScriptLoading(true)
    setPlanScript('')

    try {
      // 현재 대화 맥락을 포함한 스크립트 생성 요청 (Upsell Agent)
      const response = await fetch(`${UPSELL_AGENT_URL}/generate-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_history: messages.map(m => ({ role: m.role, content: m.content })),
          current_plan: {
            plan_name: customerInfo?.plan || 'Unknown',
            monthly_fee: 0,
            data_limit: 'Unknown',
            call_limit: '무제한',
            plan_tier: 'standard'
          },
          target_plan: {
            plan_name: selectedPlan.name,
            monthly_fee: selectedPlan.rawPrice || parseInt(selectedPlan.price.replace(/,/g, '') || '0'),
            data_limit: selectedPlan.data,
            call_limit: '무제한',
            plan_tier: 'standard'
          },
          customer_intent: 'neutral',
          intent_description: customerIntent
        })
      })

      const data = await response.json()
      setPlanScript(data.script || '스크립트를 생성할 수 없습니다.')
    } catch (error) {
      console.error('Script generation error:', error)
      setPlanScript(`고객님, 현재 사용량을 분석해본 결과 "${selectedPlan.name}" 요금제가 가장 적합해 보입니다. 월 ${selectedPlan.price}원에 ${selectedPlan.data}가 제공되어 현재보다 더 합리적으로 이용하실 수 있습니다. 변경을 도와드릴까요?`)
    } finally {
      setScriptLoading(false)
    }
  }

  // 키워드 하이라이트 함수
  const highlightKeywords = (text, keywords = ['비싸', '비싸요', '너무']) => {
    let result = text
    keywords.forEach(keyword => {
      const regex = new RegExp(`(${keyword})`, 'gi')
      result = result.replace(regex, `<span class="keyword-highlight">$1</span>`)
    })
    return result
  }

  return (
    <div className="agent-app">
      {/* Header */}
      <header className="main-header">
        <div className="header-left">
          {/* 통화 상태 표시 */}
          <div className={`call-status-badge ${callStatus === 'active' ? 'status-active' : 'status-ended'}`}>
            <span className="material-icons-outlined">
              {callStatus === 'active' ? 'phone_in_talk' : 'phone_disabled'}
            </span>
            <span>{callStatus === 'active' ? '통화중' : '통화 종료됨'}</span>
          </div>
          <div className="header-divider"></div>

          {/* Dev Tool: Simulate Call */}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button
              className="sim-call-btn"
              onClick={toggleSimulationMenu}
              style={{
                marginLeft: '10px',
                padding: '0.5rem 1rem',
                background: isSimulating ? '#eab308' : '#444',
                border: 'none',
                color: '#fff',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: '500'
              }}
            >
              <span className="material-icons-outlined" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>
                {isSimulating ? 'autorenew' : 'smart_toy'}
              </span>
              {isSimulating ? 'Simulating...' : 'Simulate Call'}
            </button>
            {simulationMenuOpen && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: '10px',
                marginTop: '5px',
                background: 'white',
                border: '1px solid #ddd',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                zIndex: 1000,
                width: '240px',
                maxHeight: '400px',
                overflowY: 'auto'
              }}>
                <div style={{ padding: '10px', borderBottom: '1px solid #eee', fontWeight: 'bold', fontSize: '14px' }}>
                  샘플 대화 선택
                </div>
                {sampleList.map(sample => (
                  <button
                    key={sample.id}
                    onClick={() => simulateConversation(sample.id)}
                    style={{
                      display: 'flex',
                      width: '100%',
                      padding: '10px',
                      border: 'none',
                      background: 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '13px',
                      borderBottom: '1px solid #f5f5f5'
                    }}
                    onMouseEnter={e => e.target.style.background = '#f9fafb'}
                    onMouseLeave={e => e.target.style.background = 'transparent'}
                  >
                    {sample.id + 1}. {sample.title}
                  </button>
                ))}
                <div style={{ padding: '5px', borderTop: '1px solid #eee' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px',
                      fontSize: '13px',
                      cursor: 'pointer',
                      color: '#555'
                    }}
                    onMouseEnter={e => e.target.style.background = '#f9fafb'}
                    onMouseLeave={e => e.target.style.background = 'transparent'}
                  >
                    <span className="material-icons-outlined" style={{ fontSize: '16px', marginRight: '8px' }}>folder_open</span>
                    파일에서 불러오기
                    <input type="file" accept=".txt,.json" onChange={handleFileUpload} hidden />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="header-center">
          {/* AIDAM을 중앙으로 이동 */}
          <h1 className="app-title">AiDam</h1>
        </div>

        <div className="header-right">
          <button
            className={`header-btn ${view === 'history' ? 'active' : ''}`}
            onClick={() => {
              if (view === 'history') {
                setView('main')
              } else {
                loadReports(null) // Load all (or handle accordingly)
                setView('history')
              }
            }}
          >
            <span className="material-icons-outlined">history</span>
            히스토리 (전체)
          </button>
        </div>
      </header >

      <main className="agent-main">
        {view === 'main' && (
          <div className="three-panel-layout">
            {/* Left Panel: Customer Info + Conversation */}
            <aside className="left-panel">
              {/* Customer Info Card */}
              <div className="info-card customer-info-card">
                <div className="card-header">
                  <h2>고객 정보</h2>
                  <button
                    className="history-link"
                    onClick={() => {
                      if (customerInfo && customerInfo.phone) {
                        loadReports(customerInfo.phone)
                        setView('history')
                      } else {
                        alert('고객 정보가 없습니다.')
                      }
                    }}
                  >
                    <span className="material-icons-outlined">history</span>
                    <span>상담 이력</span>
                  </button>
                </div>
                <div className="info-grid">
                  {customerInfo ? (
                    <>
                      <div className="info-row">
                        <span className="info-label">고객명:</span>
                        <span className="info-value">{customerInfo.name} ({customerInfo.age || '?'}세)</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">전화번호:</span>
                        <span className="info-value">{customerInfo.phone}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">현재 요금제:</span>
                        <span className="info-value plan-value">{customerInfo.plan}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">데이터 사용:</span>
                        <span className="info-value" style={{ fontSize: '0.85em', color: '#aaa' }}>
                          전월: {customerInfo.usage?.prev || '-'}, 현월: {customerInfo.usage?.curr || '-'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="no-customer-info" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                      <p>통화 대기 중...</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Conversation History */}
              <div className="info-card conversation-card">
                <div className="card-header">
                  <h2>대화 이력</h2>
                  <div className="card-actions">
                    {messages.length > 0 && (
                      <>
                        <button onClick={exportMessages} className="icon-btn" title="내보내기">
                          <span className="material-icons-outlined">save</span>
                        </button>
                        <button onClick={clearCurrentConversation} className="icon-btn" title="초기화">
                          <span className="material-icons-outlined">refresh</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {messages.length === 0 ? (
                  <div className="empty-conversation">
                    <span className="material-icons-outlined empty-icon">chat_bubble_outline</span>
                    <p>아직 통화 내용이 없습니다</p>
                    <div className="empty-actions">
                      <div className="simulation-hint" style={{ color: '#aaa', fontSize: '0.9em' }}>
                        상단 "Simulate Call" 버튼을 눌러 시뮬레이션을 시작하세요.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="chat-messages" ref={chatContainerRef} onScroll={handleScroll}>
                    {messages.map((msg, idx) => {
                      const analysis = msg.messageId ? upsellHistory[msg.messageId] : null;
                      const isSelected = selectedAnalysisId === msg.messageId;

                      return (
                        <div key={idx} className={`message-wrapper ${msg.role}`}>
                          {/* Message Bubble */}
                          <div
                            className={`chat-bubble ${msg.role} ${msg.role === 'user' ? 'clickable' : ''}`}
                            onClick={msg.role === 'user' ? () => handleCustomerMessageClick(msg.content) : undefined}
                            title={msg.role === 'user' ? '클릭하여 스크립트 생성' : ''}
                          >
                            <div className="bubble-avatar">
                              <span className="material-icons-outlined">
                                {msg.role === 'user' ? 'person' : 'smart_toy'}
                              </span>
                            </div>
                            <div className="bubble-content">
                              <div className="bubble-author">
                                {msg.role === 'user' ? '고객' : 'AI 상담사'}
                              </div>
                              <div className="bubble-text" dangerouslySetInnerHTML={{ __html: highlightKeywords(msg.content) }}></div>
                            </div>
                          </div>

                          {/* [NEW] Analysis Tag (Only for User messages) */}
                          {msg.role === 'user' && msg.messageId && (
                            <div
                              className={`analysis-tag ${analysis
                                ? (analysis.status === 'filtered'
                                  ? 'filtered'
                                  : (analysis.upsell_possibility || '').toLowerCase())
                                : 'analyzing'
                                } ${isSelected ? 'selected' : ''}`}
                              onClick={analysis && analysis.status !== 'filtered' ? (e) => handleAnalysisTagClick(msg.messageId, e) : undefined}
                              title={
                                analysis
                                  ? (analysis.status === 'filtered' ? `분석 제외: ${analysis.reason}` : "AI 분석 결과 보기")
                                  : "분석 중..."
                              }
                              style={{ cursor: (analysis && analysis.status !== 'filtered') ? 'pointer' : 'default' }}
                            >
                              <span className="material-icons-outlined tag-icon">
                                {analysis
                                  ? (analysis.status === 'filtered' ? 'block' : 'analytics')
                                  : 'hourglass_empty'
                                }
                              </span>
                              <span className="tag-label">
                                {analysis
                                  ? (analysis.status === 'filtered' ? '제외됨' : '분석 완료')
                                  : '분석중'
                                }
                              </span>
                              {isSelected && <span className="material-icons-outlined tag-check">check</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}

                  </div>
                )}
              </div>
            </aside>

            {/* Center Panel: AI Recommended Scripts */}
            <section className="center-panel">
              <RAGAssistant
                messages={messages}
                triggerMessage={triggerMessage}
                ragScripts={ragScripts}
                setRagScripts={setRagScripts}
                onClear={() => {
                  setMessages([])
                  setIsRagCleared(true)
                }}
              />
            </section>

            {/* Right Panel: Customer Intent + Recommendations */}
            <aside className="right-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              {/* Tab Buttons */}
              <div className="panel-tabs" style={{ flexShrink: 0 }}>
                <button
                  className={`tab-btn ${rightPanelTab === 'intent' ? 'active' : ''}`}
                  onClick={() => setRightPanelTab('intent')}
                >
                  고객 분석
                </button>
                <button
                  className={`tab-btn ${rightPanelTab === 'report' ? 'active' : ''} ${callStatus === 'ended' ? 'shimmer-highlight' : ''}`}
                  onClick={() => setRightPanelTab('report')}
                >
                  상담 보고서
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.5rem 0' }}>
                {rightPanelTab === 'intent' && (
                  <>
                    {/* Customer Intent Card - 개선된 스타일 */}
                    <div className="info-card intent-card">
                      <h2 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '1rem' }}>고객 의중 판단 AI</h2>
                      <div className="intent-content">
                        <p>
                          <span className="intent-highlight" style={{
                            display: 'inline-block',
                            padding: '0.5rem 1rem',
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            color: 'white',
                            borderRadius: '8px',
                            fontWeight: '600',
                            fontSize: '0.95rem',
                            boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)'
                          }}>
                            {customerIntent}
                          </span>
                        </p>

                        {/* AI Thinking Process */}
                        {(isAnalyzingIntent || aiReasoning.length > 0) && (
                          <div className="intent-reasoning" style={{ marginTop: '1rem' }}>
                            <div className="reasoning-label" style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              marginBottom: '0.75rem',
                              color: '#6366f1',
                              fontWeight: '500',
                              fontSize: '0.9rem'
                            }}>
                              <span className="material-icons-outlined">psychology</span>
                              <span>AI 사고 과정</span>
                            </div>
                            <div className="reasoning-steps" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {aiReasoning.map((step, idx) => (
                                <span key={idx} className="reasoning-step" style={{
                                  padding: '0.5rem 0.75rem',
                                  background: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '6px',
                                  fontSize: '0.85rem',
                                  color: '#475569',
                                  lineHeight: '1.5'
                                }}>{step}</span>
                              ))}
                              {isAnalyzingIntent && (
                                <span className="reasoning-step" style={{
                                  padding: '0.5rem 0.75rem',
                                  background: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '6px',
                                  fontSize: '0.85rem',
                                  color: '#475569'
                                }}>...</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Recommended Plans - 개선된 스타일 */}
                    <div className="info-card plans-card">
                      <h2 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '0.5rem' }}>추천 요금제</h2>
                      <p className="plans-subtitle" style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>고객에게 제안할 요금제:</p>

                      {/* Current Plan Display */}
                      {customerInfo && customerInfo.plan && (
                        <div className="current-plan-display-v2">
                          <div className="current-label">현재 이용중</div>
                          <div className="current-plan-row">
                            <div className="current-plan-info">
                              <span className="current-plan-name">{customerInfo.plan}</span>
                              <span className="current-plan-price">{customerInfo.billing?.toLocaleString() || '35,000'}원</span>
                            </div>
                            <div className="current-plan-badge">사용중</div>
                          </div>
                        </div>
                      )}

                      <div className="plans-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {recommendedPlans.length === 0 ? (
                          <div className="empty-plans" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                            <p>추천할 만한 요금제가 없습니다.</p>
                          </div>
                        ) : (
                          recommendedPlans.map(plan => (
                            <div
                              key={plan.id}
                              className={`plan-item ${plan.selected ? 'selected' : ''}`}
                              onClick={() => handlePlanSelect(plan.id)}
                              style={{
                                padding: '1rem',
                                background: plan.selected ? '#eff6ff' : '#fff',
                                border: plan.selected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                              }}
                            >
                              <h4 style={{
                                fontSize: '0.95rem',
                                fontWeight: '600',
                                marginBottom: '0.5rem',
                                color: plan.selected ? '#1d4ed8' : '#1e293b'
                              }}>{plan.name}</h4>
                              <div className="plan-detail-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                                <span className="plan-price" style={{ fontWeight: '600', color: '#3b82f6' }}>월 {plan.price}원</span>
                                <span className="plan-data" style={{ color: '#64748b' }}>{plan.data}</span>
                              </div>
                              {customerInfo && (
                                <div className="price-diff-badge" style={{ marginTop: '0.5rem' }}>
                                  {(() => {
                                    const currentPrice = customerInfo.billing || 35000;
                                    const diff = plan.rawPrice - currentPrice;
                                    if (diff > 0) return <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>+{diff.toLocaleString()}원</span>;
                                    if (diff < 0) return <span style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: '600' }}>{diff.toLocaleString()}원</span>;
                                    return <span style={{ color: '#64748b', fontSize: '0.8rem' }}>동일 요금</span>;
                                  })()}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>

                      {/* Plan Script Box - 개선된 스타일 */}
                      <div className="plan-script-box" style={{
                        marginTop: '1rem',
                        background: '#fff',
                        padding: '1rem',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0'
                      }}>
                        <div className="script-box-header" style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          marginBottom: '0.75rem',
                          color: '#64748b',
                          fontSize: '0.85rem',
                          fontWeight: '500'
                        }}>
                          <span className="material-icons-outlined" style={{ fontSize: '18px' }}>edit_note</span>
                          <span>추천 스크립트</span>
                        </div>
                        {scriptLoading ? (
                          <div className="script-loading" style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '1.5rem',
                            gap: '0.75rem'
                          }}>
                            <div className="script-loader"></div>
                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>스크립트 생성 중...</span>
                          </div>
                        ) : planScript ? (
                          <div className="script-content-box" style={{
                            padding: '0.75rem',
                            background: '#f8fafc',
                            borderRadius: '6px',
                            lineHeight: '1.6',
                            fontSize: '0.9rem',
                            color: '#334155'
                          }}>
                            <p style={{ margin: 0 }}>{planScript}</p>
                          </div>
                        ) : (
                          <div className="script-placeholder" style={{
                            padding: '1.5rem',
                            textAlign: 'center',
                            color: '#94a3b8',
                            fontSize: '0.85rem',
                            lineHeight: '1.6'
                          }}>
                            <p style={{ margin: 0 }}>요금제를 선택하면 현재 대화 맥락에 맞는<br />추천 스크립트가 생성됩니다.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {rightPanelTab === 'report' && (
                  <div className="report-panel-content">
                    {processing && (
                      <div className="report-loading">
                        <div className="loading-header">
                          <div className="loading-spinner"></div>
                          <h3>보고서 생성 중...</h3>
                        </div>

                        <div className="progress-container">
                          <div className="progress-bar-track">
                            <div
                              className="progress-bar-fill"
                              style={{ width: `${(processingStep / 5) * 100}%` }}
                            ></div>
                          </div>

                          <div className="progress-steps-compact">
                            {['준비', '분석', '생성', '저장', '완료'].map((label, idx) => (
                              <div
                                key={idx}
                                className={`step-compact ${processingStep >= idx + 1 ? 'active' : ''} ${processingStep > idx + 1 ? 'completed' : ''}`}
                              >
                                <div className="step-dot"></div>
                                <span>{label}</span>
                              </div>
                            ))}
                          </div>

                          <div className="progress-status">
                            <div className="status-message">{processingMessage}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {!processing && !currentReport && (
                      <div className="empty-report">
                        <span className="material-icons-outlined empty-icon">description</span>
                        <p>보고서가 아직 생성되지 않았습니다.</p>
                        <p className="empty-help">
                          상담이 종료되면<br />
                          "보고서 생성" 버튼을 클릭하세요.
                        </p>
                        {messages.length > 0 && (
                          <button onClick={handleProcess} className={`generate-report-btn ${callStatus === 'ended' ? 'shimmer-highlight' : ''}`}>
                            <span className="material-icons-outlined">summarize</span>
                            보고서 생성
                          </button>
                        )}
                      </div>
                    )}

                    {!processing && currentReport && (
                      <div className="report-content">
                        <div className="summary-section">
                          <h3>📋 요약</h3>
                          <p>{currentReport.analysis?.summary}</p>
                        </div>

                        <div className="topics-section">
                          <h4>주요 주제</h4>
                          <div className="topic-tags">
                            {currentReport.analysis?.main_topics?.map((topic, i) => (
                              <span key={i} className="topic-tag">{topic}</span>
                            ))}
                          </div>
                        </div>

                        <div className="stats-section">
                          <div className="stat-item">
                            <span className="stat-number">{currentReport.analysis?.statistics?.total_messages}</span>
                            <span className="stat-label">전체</span>
                          </div>
                          <div className="stat-item">
                            <span className="stat-number">{currentReport.analysis?.statistics?.user_messages}</span>
                            <span className="stat-label">고객</span>
                          </div>
                          <div className="stat-item">
                            <span className="stat-number">{currentReport.analysis?.statistics?.assistant_messages}</span>
                            <span className="stat-label">상담사</span>
                          </div>
                        </div>

                        <div className="detailed-report">
                          <h3>📝 상세 보고서</h3>
                          <div className="markdown-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {currentReport.report}
                            </ReactMarkdown>
                          </div>

                          {/* 보고서 재생성 버튼 */}
                          <div className="report-actions-footer">
                            <button
                              onClick={handleProcess}
                              className="regenerate-report-btn"
                              disabled={regenerating || processing}
                            >
                              <span className="material-icons-outlined">refresh</span>
                              {regenerating ? '재생성 중...' : '보고서 재생성'}
                            </button>
                            {currentReport.regeneration_count > 0 && (
                              <span className="regeneration-badge">
                                {currentReport.regeneration_count}회 재생성됨
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )
        }

        {
          view === 'history' && (
            <div className="history-view">
              <div className="history-header">
                <h2>📚 보고서 히스토리</h2>
                <button onClick={() => setView('main')} className="back-btn">
                  <span className="material-icons-outlined">arrow_back</span>
                  돌아가기
                </button>
              </div>

              {reports.length === 0 ? (
                <div className="empty-state">
                  <span className="material-icons-outlined empty-icon">folder_open</span>
                  <p>저장된 보고서가 없습니다</p>
                </div>
              ) : (
                <div className="report-list">
                  {reports.map(report => (
                    <div key={report.id} className="report-item">
                      <div className="report-header-row">
                        <div className="report-info">
                          <div className="report-title-row">
                            {report.customer_name && (
                              <h3 className="customer-name-title">{report.customer_name}</h3>
                            )}
                            {report.customer_phone && (
                              <span className="customer-phone-badge">{report.customer_phone}</span>
                            )}
                          </div>
                          <span className="report-date">
                            <span className="material-icons-outlined">schedule</span>
                            {new Date(report.created_at).toLocaleString('ko-KR', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          <span className="report-id-small">ID: {report.id}</span>
                        </div>
                        <div className="report-actions">
                          <button
                            onClick={() => viewReport(report.id)}
                            className="view-btn"
                          >
                            <span className="material-icons-outlined">visibility</span>
                            보기
                          </button>
                          <button
                            onClick={(e) => deleteReport(report.id, e)}
                            className="delete-btn"
                          >
                            <span className="material-icons-outlined">delete</span>
                            삭제
                          </button>
                        </div>
                      </div>
                      {report.summary && (
                        <div className="report-preview">
                          <span className="preview-label">
                            <span className="material-icons-outlined">summarize</span>
                            요약:
                          </span>
                          <span className="preview-text">{report.summary}</span>
                        </div>
                      )}
                      {report.topics && report.topics.length > 0 && (
                        <div className="report-topics">
                          {report.topics.map((topic, i) => (
                            <span key={i} className="topic-badge">{topic}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        }

        {
          view === 'report_detail' && currentReport && (
            <div className="report-detail-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f7fa', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}>
              {/* Detail Header */}
              <header className="detail-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 25px', background: '#fff', borderBottom: '1px solid #e0e0e0', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                <div className="header-info" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <button
                    onClick={() => setView('history')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#666', fontSize: '15px' }}
                  >
                    <span className="material-icons-outlined" style={{ marginRight: '5px' }}>arrow_back</span>
                    목록으로
                  </button>
                  <div style={{ width: '1px', height: '20px', background: '#e0e0e0' }}></div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span>{currentReport.customer_phone ? `고객: ${currentReport.customer_phone}` : '고객 정보 없음'}</span>
                      <span style={{ fontSize: '14px', color: '#888', fontWeight: 'normal' }}>| {new Date(currentReport.created_at).toLocaleString()}</span>
                    </h2>
                    <span style={{ fontSize: '12px', color: '#aaa' }}>ID: {currentReport.reportId}</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setView('main')
                    setMessages([])
                    setCurrentReport(null)
                  }}
                  style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
                >
                  상담으로 돌아가기
                </button>
              </header>

              {/* 3-Column Layout */}
              <div className="detail-content" style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: '2px' }}>

                {/* 1. Chat Log (Left) */}
                <section className="detail-col text-col" style={{ flex: 1, background: '#fff', borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', minWidth: '350px' }}>
                  <div className="col-header" style={{ padding: '15px', borderBottom: '1px solid #eee', fontWeight: '600', color: '#444' }}>
                    <span className="material-icons-outlined" style={{ verticalAlign: 'middle', marginRight: '8px', fontSize: '18px' }}>chat</span>
                    상담 대화 내용
                  </div>
                  <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                    {messages.map((msg, idx) => (
                      <div key={idx} className={`chat-bubble ${msg.role}`} style={{ opacity: 0.9 }}>
                        <div className="bubble-content">
                          <span className="bubble-author">
                            {msg.role === 'user' ? '고객' : '상담사'}
                          </span>
                          <div className="bubble-text">{msg.content}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* 2. RAG/Upsell Context (Center) */}
                <section className="detail-col context-col" style={{ flex: 1, background: '#f8fafc', borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', minWidth: '350px' }}>
                  <div className="col-header" style={{ padding: '15px', borderBottom: '1px solid #eee', fontWeight: '600', color: '#444' }}>
                    <span className="material-icons-outlined" style={{ verticalAlign: 'middle', marginRight: '8px', fontSize: '18px' }}>psychology</span>
                    상담 당시 AI 제안 (RAG & Upsell)
                  </div>
                  <div className="context-content" style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>

                    {/* RAG Scripts */}
                    {currentReport.ui_snapshot?.ragScripts && currentReport.ui_snapshot.ragScripts.length > 0 && (
                      <div className="info-card rag-scripts-card" style={{ marginBottom: '20px' }}>
                        <h3>
                          <span className="material-icons-outlined" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '8px' }}>auto_awesome</span>
                          생성된 상담 가이드
                        </h3>
                        <div style={{ marginTop: '15px' }}>
                          {currentReport.ui_snapshot.ragScripts.map((script, idx) => (
                            <div
                              key={script.id || idx}
                              className="rag-script-item"
                              style={{
                                padding: '12px',
                                background: script.isError ? '#fef2f2' : '#fff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                marginBottom: '10px'
                              }}
                            >
                              <h4 style={{ fontSize: '13px', fontWeight: '600', color: '#555', marginBottom: '8px' }}>
                                {script.isAutoGenerated && '🤖 '}{script.isManual && '📖 '}{script.title}
                              </h4>
                              <p style={{ fontSize: '12px', lineHeight: '1.6', color: '#333', whiteSpace: 'pre-wrap' }}>
                                {script.content}
                              </p>
                              {script.sources && script.sources.length > 0 && (
                                <div style={{ marginTop: '8px', fontSize: '11px', color: '#666' }}>
                                  {script.sources.map((source, sIdx) => (
                                    <div key={sIdx} style={{ padding: '4px 8px', background: '#f9fafb', borderRadius: '4px', marginTop: '4px' }}>
                                      📄 {source.page ? `매뉴얼 p.${source.page}` : '참조 문서'}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recovered Intent - 프론트 스타일 적용 */}
                    <div className="info-card intent-card" style={{ marginBottom: '20px' }}>
                      <h2 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '1rem' }}>고객 의중 판단 AI</h2>
                      <div className="intent-content">
                        <p>
                          <span className="intent-highlight" style={{
                            display: 'inline-block',
                            padding: '0.5rem 1rem',
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            color: 'white',
                            borderRadius: '8px',
                            fontWeight: '600',
                            fontSize: '0.95rem'
                          }}>
                            {currentReport.ui_snapshot?.customerIntent || '기록된 의중 데이터 없음'}
                          </span>
                        </p>

                        {/* AI Thinking Process */}
                        {currentReport.ui_snapshot?.aiReasoning && currentReport.ui_snapshot.aiReasoning.length > 0 && (
                          <div className="intent-reasoning" style={{ marginTop: '1rem' }}>
                            <div className="reasoning-label" style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              marginBottom: '0.75rem',
                              color: '#6366f1',
                              fontWeight: '500'
                            }}>
                              <span className="material-icons-outlined">psychology</span>
                              <span>AI 사고 과정</span>
                            </div>
                            <div className="reasoning-steps" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {currentReport.ui_snapshot.aiReasoning.map((step, idx) => (
                                <span key={idx} className="reasoning-step" style={{
                                  padding: '0.5rem 0.75rem',
                                  background: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '6px',
                                  fontSize: '0.85rem',
                                  color: '#475569',
                                  lineHeight: '1.5'
                                }}>{step}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Recovered Plans - 프론트 스타일 적용 */}
                    <div className="info-card plans-card" style={{ marginBottom: '20px' }}>
                      <h2 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '0.5rem' }}>추천 요금제</h2>
                      <p className="plans-subtitle" style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>고객에게 제안할 요금제:</p>

                      {/* Current Plan Display */}
                      {messages.length > 0 && messages[0].content && (
                        <div className="current-plan-display-v2">
                          <div className="current-label">현재 이용중</div>
                          <div className="current-plan-row">
                            <div className="current-plan-info">
                              <span className="current-plan-name">
                                {/* 보고서 content에서 요금제 정보 추출 또는 기본값 */}
                                {currentReport.content?.match(/\*\*요금제\*\*:\s*([^\n]+)/)?.[1] || '현재 요금제'}
                              </span>
                            </div>
                            <div className="current-plan-badge">사용중</div>
                          </div>
                        </div>
                      )}

                      <div className="plans-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {(currentReport.ui_snapshot?.recommendedPlans || []).length === 0 ? (
                          <div className="empty-plans" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                            <p>추천할 만한 요금제가 없습니다.</p>
                          </div>
                        ) : (
                          (currentReport.ui_snapshot?.recommendedPlans || []).map((plan, idx) => (
                            <div
                              key={idx}
                              className={`plan-item ${plan.id === currentReport.ui_snapshot?.selectedPlanId ? 'selected' : ''}`}
                              style={{
                                padding: '1rem',
                                background: plan.id === currentReport.ui_snapshot?.selectedPlanId ? '#eff6ff' : '#fff',
                                border: plan.id === currentReport.ui_snapshot?.selectedPlanId ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                                borderRadius: '8px',
                                cursor: 'default',
                                transition: 'all 0.2s'
                              }}
                            >
                              <h4 style={{
                                fontSize: '0.95rem',
                                fontWeight: '600',
                                marginBottom: '0.5rem',
                                color: plan.id === currentReport.ui_snapshot?.selectedPlanId ? '#1d4ed8' : '#1e293b'
                              }}>{plan.name}</h4>
                              <div className="plan-detail-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                                <span className="plan-price" style={{ fontWeight: '600', color: '#3b82f6' }}>월 {plan.price}원</span>
                                <span className="plan-data" style={{ color: '#64748b' }}>{plan.data}</span>
                              </div>
                              {plan.rawPrice && (
                                <div className="price-diff-badge" style={{ marginTop: '0.5rem' }}>
                                  {(() => {
                                    const currentPrice = 35000; // 기본값 또는 보고서에서 추출
                                    const diff = plan.rawPrice - currentPrice;
                                    if (diff > 0) return <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>+{diff.toLocaleString()}원</span>;
                                    if (diff < 0) return <span style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: '600' }}>{diff.toLocaleString()}원</span>;
                                    return <span style={{ color: '#64748b', fontSize: '0.8rem' }}>동일 요금</span>;
                                  })()}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Recovered Script - 프론트 스타일 적용 */}
                    {currentReport.ui_snapshot?.planScript && (
                      <div className="plan-script-box" style={{
                        marginTop: '0',
                        background: '#fff',
                        padding: '1rem',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0'
                      }}>
                        <div className="script-box-header" style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          marginBottom: '0.75rem',
                          color: '#64748b',
                          fontSize: '0.85rem',
                          fontWeight: '500'
                        }}>
                          <span className="material-icons-outlined" style={{ fontSize: '18px' }}>edit_note</span>
                          <span>추천 스크립트</span>
                        </div>
                        <div className="script-content-box" style={{
                          padding: '0.75rem',
                          background: '#f8fafc',
                          borderRadius: '6px',
                          lineHeight: '1.6',
                          fontSize: '0.9rem',
                          color: '#334155'
                        }}>
                          <p style={{ margin: 0 }}>{currentReport.ui_snapshot.planScript}</p>
                        </div>
                      </div>
                    )}

                  </div>
                </section>

                {/* 3. Report (Right) */}
                <section className="detail-col report-col" style={{ flex: 1.2, background: '#fff', display: 'flex', flexDirection: 'column', minWidth: '400px' }}>
                  <div className="col-header" style={{ padding: '15px', borderBottom: '1px solid #eee', fontWeight: '600', color: '#444' }}>
                    <span className="material-icons-outlined" style={{ verticalAlign: 'middle', marginRight: '8px', fontSize: '18px' }}>summarize</span>
                    최종 상담 보고서
                  </div>
                  <div className="markdown-content" style={{ padding: '30px', overflowY: 'auto', flex: 1 }}>
                    {/* Re-use ReactMarkdown */}
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {currentReport.report}
                    </ReactMarkdown>
                  </div>
                </section>

              </div>
            </div>
          )
        }

        {
          view === 'samples' && (
            <div className="samples-view">
              <div className="samples-header">
                <h2>샘플 대화 목록</h2>
                <button onClick={() => setView('main')} className="back-btn">
                  <span className="material-icons-outlined">arrow_back</span>
                  돌아가기
                </button>
              </div>

              <div className="sample-list">
                {sampleList.map(sample => (
                  <div
                    key={sample.id}
                    className="sample-item"
                    onClick={() => loadSampleConversation(sample.id)}
                  >
                    <div className="sample-number">#{sample.id}</div>
                    <div className="sample-info">
                      <h3 className="sample-title">{sample.title}</h3>
                    </div>
                    <span className="material-icons-outlined sample-arrow">arrow_forward</span>
                  </div>
                ))}
              </div>
            </div>
          )
        }
      </main >
    </div >
  )
}

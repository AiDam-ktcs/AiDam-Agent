## Main Backend 수신 API (STT 서비스 -> Main Backend)
STT 서비스가 데이터를 생성했을 때 Main Backend로 전송하기 위해 호출

### 1. 대화 라인 및 키워드 전송
STT로 변환된 대화 내용과 해당 라인에서 추출된 키워드를 전송합니다.

*   **Endpoint**: `/api/stt/line`
*   **Method**: `POST`
*   **Request Body**:
    ```json
    {
      "callId": "string (통화 식별 ID)",
      "speaker": "string ('customer' | 'agent')",
      "text": "string (변환된 대화 텍스트)",
      "keywords": ["string", "string"] // 해당 라인의 주요 키워드 리스트
    }
    ```
*   **Response**: `200 OK`

### 2. 상대방 전화번호 전송
통화 시작 시 또는 번호 식별 시점에 상대방의 전화번호 정보를 전송합니다.

*   **Endpoint**: `/api/stt/call-start`
*   **Method**: `POST`
*   **Request Body**:
    ```json
    {
      "callId": "string (통화 식별 ID)",
      "phoneNumber": "string (010-XXXX-XXXX)",
      "timestamp": "ISO8601 string"
    }
    ```
*   **Response**: `200 OK`

---

## 3. STT 서비스 조회 API (Main Backend -> STT 서비스)
Main Backend가 STT 서비스(Port 8080)의 상태를 확인하기 위해 호출하는 API입니다.

### 3.1 통화 연결 상태 확인
현재 통화가 진행 중인지, 끊김 상태인지 확인합니다.

*   **Target URL**: `http://localhost:8080/api/call/status`
*   **Method**: `GET`
*   **Response Body**:
    ```json
    {
      "callId": "string",
      "status": "string ('active' | 'disconnected' | 'idle')",
      "duration": "number (통화 지속 시간, 초)" // Optional
    }
    ```

---

## 4. 공통 기본 통신 API (All Backends Common)
STT 서비스를 포함한 모든 백엔드 마이크로서비스가 공통적으로 제공해야 하는 기본 관리용 API입니다.

### 4.1 서비스 헬스 체크 (Health Check)
Main Backend 또는 모니터링 시스템이 서비스의 생존 여부(Liveness)를 확인하기 위해 호출합니다.

*   **Endpoint**: `/health`
*   **Method**: `GET`
*   **Response**: `200 OK`
    *   서비스가 정상 동작 중일 때 반환합니다.
    ```json
    {
      "status": "ok",
      "service": "stt-service", // 각 서비스 식별자
      "uptime": 123456 // 가동 시간 (초, Optional)
    }
    ```

### 4.2 서비스 메타 정보 (Service Info)
서비스의 버전 및 기본 설정을 확인합니다.

*   **Endpoint**: `/info`
*   **Method**: `GET`
*   **Response**: `200 OK`
    ```json
    {
      "service": "stt-service",
      "version": "0.1.0",
      "description": "Speech To Text Analysis Service"
    }
    ```

---

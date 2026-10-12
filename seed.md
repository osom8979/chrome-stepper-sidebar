<!-- Chrome Stepper Sidebar 예시 시나리오. 처음 설치할 때 한 번 들어간다. 형식은 README.md 참고 -->

# MLOps 플랫폼 시연

- 기본 URL: http://localhost:5173
- 이동 방식: spa

## 시작

### 대시보드

- URL: /

테넌트 단위 현황을 한 화면에서 보여 준다.

## 데이터

### 데이터셋 목록

- URL: /datasets

데이터셋은 생성 즉시 확정되고 파일은 자유롭게 추가·삭제한다.

### 데이터셋 상세

- URL: /datasets/ds-xxxxxxxxxxxx
- 판정: regex `^/datasets/ds-[^/]+$`

ID 는 시연 환경의 실제 값으로 바꿀 것.
개요 탭과 파일 탭을 차례로 보여 준다.

## 학습

### 새 학습

- URL: /training/new

배선된 GPU 자원만 고를 수 있다는 점을 짚는다.

### 학습 목록

- URL: /training

### 실험

- URL: /experiments

지표는 MLflow 가 단일 소스다.

## 배포

### 모델 레지스트리

- URL: /model-registry
- 판정: prefix

### 배포

- URL: /deployments

### 모니터링

- URL: /monitoring

## 엣지

### Edge Fleet

- URL: /edge-fleet
- 판정: prefix

### 수집 데이터

- URL: /collected-data

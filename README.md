# Time-Off Microservice (ExampleHR)

A robust, fault-tolerant NestJS microservice designed to manage the lifecycle of employee time-off requests while maintaining strict balance synchronization with an external Human Capital Management (HCM) system. 

## Overview & Key Features 

This project addresses the notoriously difficult "Dual-Brain Problem" in distributed systems, where an external system (HCM) remains the absolute Source of Truth, but a local system (ExampleHR) needs to provide instant feedback and prevent race conditions. 

**Architectural Highlights:** 
* **Ledger Pattern:** Instead of simple CRUD updates, balances are calculated dynamically from an immutable ledger (ACCRUAL, CONSUMPTION, HCM_ADJUSTMENT), preventing race conditions and ensuring accurate historical auditing. 
* **Anti-Corruption Layer (ACL):** The HcmGatewayService isolates the core domain from external network instability. 
* **Defensive Concurrency Handling:** Uses explicit database transactions (QueryRunner) to ensure atomicity. If an employee tries to double-spend time off, the transaction is safely rolled back. 
* **Fire-and-Forget Sync:** External API calls are handled asynchronously so the user gets an instant 201 Created response without waiting for network latency. 
* **Self-Healing Batch Reconciliation:** The webhook endpoint can process massive payload updates from the HCM, automatically creating compensating adjustments and cancelling pending requests if an external deduction causes a local overdraft. 

## Prerequisites

* Node.js (v18.x or higher recommended)
* npm (comes with Node.js)

*Note: No external database installation is required. This project uses SQLite, which will automatically create a local `database.sqlite` file upon startup.* 

## Setup & Installation

1. Clone the repository and navigate into the project directory. 
2. Install the required dependencies: 

```bash
npm install
```

## Running the Application 

To start the microservice in development mode with hot-reloading: 

```bash
npm run start:dev
```

The server will start on `http://localhost:3000` with the global prefix `/api/v1`. 

## Testing & Proof of Coverage 

The true value of this implementation lies in its rigorous testing strategy. The system relies on deep Unit and Service-Level Integration tests using advanced TypeORM mocking, ensuring the transaction lifecycles and business logic are fully deterministic.

### Run the Test Suite 

To execute the tests:

```bash
npm run test
```

### Generate Coverage Report 

To view the proof of coverage (verifying that all edge cases, rollbacks, and self-healing logic are tested): 

```bash
npm run test:cov
```

This command will output a coverage table in your terminal. You can also view a detailed, interactive HTML report by opening `coverage/lcov-report/index.html` in your browser.

---

## Main API Endpoints 

### 1. Create a Time-Off Request 

* **POST** `/api/v1/time-off/request` 

**Payload:** 

```json
{
  "employeeld": "emp-123",
  "locationId": "loc-ny",
  "amount": 2
}
```

### 2. HCM Batch Synchronization (Webhook) 

* **POST** `/api/v1/webhooks/hcm/batch-sync` 

**Payload:** 

```json
{
  "balances": [
    {
      "employeeld": "emp-123",
      "locationId": "loc-ny",
      "balance": 15
    }
  ]
}
```
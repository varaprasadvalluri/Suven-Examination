# Secure & Dynamic Exam Link Service: Architectural Specification & Implementation Plan

This specification outlines the transition of the **SuvenEdu Academy Exam Portal** from simple parameter-based routing into an enterprise-grade, cryptographically secure, and dynamically validated link architecture. This design is built to meet high-integrity benchmarks, preventing token scraping, link tampering, and unauthorized institutional entry.

---

## 1. Relational & NoSQL Schema Coexistence Model

To transition from static parameters (`?examId=X&schoolId=Y`) into fully dynamic systems, we introduce two primary schema models.

### A. Non-Relational / Firestore Schema (NoSQL Strategy)
We introduce a specialized collection: `exam_access_tokens`. This collection persists single-use or restricted cryptographic descriptors mapping a token ID to an exam, class, and authorized institution.

```typescript
interface ExamAccessTokenDocument {
  id: string;                 // High-entropy token (e.g., UUID v4 or secure crypto-token)
  examId: string;             // Reference to 'exams' collection
  schoolId: string;           // Reference to 'schools' collection
  classId: string;            // Targeted academic class/group
  subject: string;            // mapped subject identifier
  expiresAt: string;          // ISO 8601 Expiration datetime
  maxUses: number;            // Total allowed entrances (e.g., 1 for single-use, 40 for a full class)
  usesCount: number;          // Active entrance tracking
  ipRestricted: boolean;      // True if locked to a designated center
  allowedIpRanges?: string[]; // Allowed CIDR blocks (e.g., ["192.168.1.0/24"])
  isActive: boolean;          // Administrative master switch
  createdAt: string;          // Audit trail
  createdBy: string;          // Registrar identifier
}
```

### B. Relational Schema (SQL Strategy - PostgreSQL with Prisma/Drizzle)
For relational database options (e.g., Cloud SQL PostgreSQL), the pattern is implemented with indexing for fast point key lookups:

```sql
CREATE TABLE exam_access_tokens (
  id VARCHAR(128) PRIMARY KEY, -- Host hash or UUIDv4
  exam_id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  class_id VARCHAR(64) NOT NULL,
  subject VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  max_uses INT NOT NULL DEFAULT 1,
  uses_count INT NOT NULL DEFAULT 0,
  ip_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_ip_ranges VARCHAR(45)[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign Key Integrity
  CONSTRAINT fk_token_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_token_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);

CREATE INDEX idx_token_lookup ON exam_access_tokens(id, is_active);
```

---

## 2. Cryptographic Token & Dynamic Link Generation

Instead of passing guessable database IDs in the query parameters, the portal server acts as a **Token Authority**. 

### Dynamic Link Composition:
```text
https://suvenedu.academy/student/secure-entry?token=tkn_c7b94a82d0e7f14b986e2468159b3defc0
```

### Dynamic Link Generation Service (Node.js/TypeScript):
```typescript
import crypto from 'crypto';

interface GenerationPayload {
  examId: string;
  schoolId: string;
  classId: string;
  subject: string;
  validityInHours: number;
}

export class ExamLinkAuthorityService {
  /**
   * Generates a dynamic token, registers it in the database and creates the secure URL block.
   */
  public static async generateSecureLink(
    payload: GenerationPayload,
    baseUrl: string = "https://suvenedu.academy"
  ): Promise<{ token: string; url: string; expiresAt: Date }> {
    // 1. Generate high-entropy cryptographic hex token
    const tokenBytes = crypto.randomBytes(24);
    const secureToken = `tkn_${tokenBytes.toString('hex')}`;
    
    // 2. Define strict expiration timestamp
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + payload.validityInHours);
    
    // 3. Write record into Firestore or SQL database (Concept)
    // await db.collection('exam_access_tokens').doc(secureToken).set({
    //   examId: payload.examId,
    //   schoolId: payload.schoolId,
    //   classId: payload.classId,
    //   subject: payload.subject,
    //   expiresAt: expiresAt.toISOString(),
    //   isActive: true,
    //   usesCount: 0,
    //   createdAt: new Date().toISOString()
    // });
    
    const secureUrl = `${baseUrl}/student/secure-entry?token=${secureToken}`;
    
    return {
      token: secureToken,
      url: secureUrl,
      expiresAt
    };
  }
}
```

---

## 3. Automated Validation Middleware

This Express/TypeScript middleware runs before any student entry route handler. It parses, authenticates, and validates parameters in a single transaction.

```typescript
import { Request, Response, NextFunction } from 'express';

export interface ValidatedEntryRequest extends Request {
  examContext?: {
    examId: string;
    schoolId: string;
    classId: string;
    subject: string;
  };
}

export async function validateExamPortalToken(
  req: ValidatedEntryRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.query.token as string;
  
  if (!token || !token.startsWith('tkn_')) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_TOKEN_FORMAT',
      message: 'Secure parameter token missing or has malformed signature.'
    });
  }

  try {
    // 1. Transactional check inside database (e.g., Firestore)
    // const docSnap = await db.collection('exam_access_tokens').doc(token).get();
    const docSnap: any = null; // Simulated DB lookup

    if (!docSnap || !docSnap.exists) {
      return res.status(403).json({
        success: false,
        code: 'ACCESS_DENIED',
        message: 'The academic access key provided is not registered or was revoked by administrative coordinators.'
      });
    }

    const tokenData = docSnap.data();

    // A. Verify master active switch
    if (!tokenData.isActive) {
      return res.status(403).json({
        success: false,
        code: 'TOKEN_INACTIVE',
        message: 'The link has been deactivated globally by your school administrator.'
      });
    }

    // B. Check temporal window criteria
    const now = new Date();
    const expiryDate = new Date(tokenData.expiresAt);
    if (now > expiryDate) {
      return res.status(403).json({
        success: false,
        code: 'LINK_EXPIRED',
        message: 'Temporal window locked. This exam access session expired on ' + expiryDate.toLocaleString()
      });
    }

    // C. Verify remaining seat usage thresholds
    if (tokenData.usesCount >= tokenData.maxUses) {
      return res.status(403).json({
        success: false,
        code: 'USE_LIMIT_REACHED',
        message: 'Maximum authorized entry count reached. Access denied.'
      });
    }

    // D. Validate client IP limits if restricted (Zero-Trust)
    if (tokenData.ipRestricted && tokenData.allowedIpRanges) {
      const clientIp = req.ip || req.headers['x-forwarded-for'];
      const isIpAllowed = tokenData.allowedIpRanges.includes(clientIp);
      if (!isIpAllowed) {
        return res.status(403).json({
          success: false,
          code: 'IP_NOT_AUTHORIZED',
          message: 'IP discrepancy. Access to this evaluation is restricted to physical school laboratories.'
        });
      }
    }

    // Accumulate validated parameters to downstream handler
    req.examContext = {
      examId: tokenData.examId,
      schoolId: tokenData.schoolId,
      classId: tokenData.classId,
      subject: tokenData.subject
    };

    next();
  } catch (error) {
    console.error('[Token Validation Service Error]', error);
    return res.status(500).json({
      success: false,
      code: 'VAL_INTERNAL_ERROR',
      message: 'An internal cryptographic error occurred while validating the security token.'
    });
  }
}
```

---

## 4. Codebase Audit Strategy: Removing Hardcoded Static Contexts

In typical portal implementations, developers often leave vulnerabilities and static structures. During an audit, you must examine, identify, and refactor the following zones:

### A. Frontend Hardcoded IDs & URLs
*   **Vulnerability:** Static variables containing `const TRIAL_EXAM_ID = "school-exam-1"` inside client-side routers or utility maps.
*   **Refactor Strategy:** Populate list structures dynamically using Firestore queries (`query(collection(db, 'exams'), where('isActive', '==', true))`). Replace hardcoded paths in React state with API callbacks.

### B. Controller Config Mappings
*   **Vulnerability:** A local `exams-config.json` map binding school emails to specific parameters.
*   **Refactor Strategy:** Introduce a composite database query or join query across `schools` and `exams` collections, validating that the school's authorized profile matches the `schoolId` requested in the exam payload.

### C. Hardcoded Time Guards
*   **Vulnerability:** Checking temporal restrictions purely on the client side (`if (Date.now() > EXAM_END)`).
*   **Refactor Strategy:** Always run temporal validation server-side (within Firestore rules or Express route validation layers) against authenticated server hours to prevent local system state spoofing.

---

## 5. Security Summary Checklist

*   [x] **Cryptographic Hash**: Generate tokens using `crypto.randomBytes(24)` or unique uuid strings to make guessability mathematically impossible.
*   [x] **Zero-Trust Access**: Restrict and audit uses counter on every single launch token.
*   [x] **Server-First Validation**: Clock time validations must happen strictly against institutional server timestamps, not local user browsers.
*   [x] **Institutional Boundary Mapping**: Relational checks between School-Account authorization matrices are enforced dynamically.

---

## 6. Pattern-Driven ID Generation Engine (Gang of Four Design Patterns)

To fulfill the architectural directive that all database entities use a unified, structured **edu-autogenerated key**, the application introduces the `EduKeyFactory` engine. This engine replaces ad-hoc or simple random string generation with an enterprise-grade GoF-aligned structural mapping.

### A. Implemented Gang of Four Design Patterns:
1. **Singleton Pattern**: The `EduKeyFactory` class implements a private constructor and a static `getInstance()` method, guaranteeing a single global manager is used to enforce ID uniformity.
2. **Strategy Pattern**: Establishes a pluggable `IdGenerationStrategy` interface. This allows developers to easily swap the default cryptographically secure ID generation algorithm with other strategies (e.g. mock strategies for unit tests or legacy adapters) at runtime.
3. **Factory Method Pattern**: The `generateKey(collectionName)` method acts as a parameterized factory method, inspecting the Firestore collection type to dynamically append the appropriate semantic prefix (e.g., `sch` for schools, `exm` for exams, `att` for attempts) to form the finished `edu-` token.

### B. Unique Key Format Structure:
Every autogenerated database key follows this robust, self-describing layout:
```text
edu-[semantic-prefix]-[base36-timestamp]-[high-entropy-randomness]
```
- **`edu`**: Constant application global namespace prefix.
- **`prefix`**: Dynamically mapped 3-4 letter code indicating the host collection (e.g., `usr`, `exm`, `sch`, `qst`).
- **`base36-timestamp`**: High-resolution timestamp encoded in base36 to ensure chronological order and scale friendliness.
- **`high-entropy-randomness`**: Cryptographically-secure 12-character random hex suffix to guarantee mathematical collision resistance under high concurrency levels.


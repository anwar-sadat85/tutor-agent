import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { GeneratedWorksheet } from './generateWorksheet.js';

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.STUDENTS_TABLE_NAME ?? 'TutorStudents';

export interface StudentState {
  studentId: string;
  email?: string;
  yearLevel?: number;
  passCount: number;
  completed: boolean;
  // The full worksheet most recently generated for this student, including
  // its answer key — this is what assess_submission needs to grade against,
  // and it must survive across separate AgentCore sessions (generation and
  // grading happen as two different invocations, potentially far apart in
  // time), so it lives here rather than in any session-local state.
  currentWorksheet?: GeneratedWorksheet;
  topicHistory: string[];
}

const DEFAULT_STATE: Omit<StudentState, 'studentId'> = {
  passCount: 0,
  completed: false,
  topicHistory: [],
};

export async function getStudentState(studentId: string): Promise<StudentState> {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { studentId } })
  );
  const item = result.Item;

  if (!item) {
    return { studentId, ...DEFAULT_STATE };
  }

  return {
    studentId,
    email: item.email,
    yearLevel: item.yearLevel,
    passCount: item.passCount ?? 0,
    completed: item.completed ?? false,
    currentWorksheet: item.currentWorksheet,
    topicHistory: item.topicHistory ?? [],
  };
}

export interface StudentStateUpdates {
  email?: string;
  yearLevel?: number;
  passCount?: number;
  completed?: boolean;
  currentWorksheet?: GeneratedWorksheet;
  topicHistory?: string[];
}

/**
 * Persists a partial update to a student's state. Only the fields provided
 * are changed — this is a merge, not a full overwrite, so callers can update
 * just the worksheet without needing to know the current passCount, etc.
 */
export async function updateStudentState(
  studentId: string,
  updates: StudentStateUpdates
): Promise<void> {
  const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  const updateExpression = 'SET ' + entries.map(([k]) => `#${k} = :${k}`).join(', ');
  const expressionAttributeNames = Object.fromEntries(entries.map(([k]) => [`#${k}`, k]));
  const expressionAttributeValues = Object.fromEntries(entries.map(([k, v]) => [`:${k}`, v]));

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { studentId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}
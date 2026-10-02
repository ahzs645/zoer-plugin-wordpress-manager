import { getApiBase } from "../api/_http"; export const databaseKeys = { all: () => ["databases",getApiBase()] as const };

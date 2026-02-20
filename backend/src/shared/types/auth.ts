export enum Role {
  SOLFACIL_ADMIN = "SOLFACIL_ADMIN",
  ORG_MANAGER    = "ORG_MANAGER",
  ORG_OPERATOR   = "ORG_OPERATOR",
  ORG_VIEWER     = "ORG_VIEWER",
}

export interface TenantContext {
  readonly userId: string;
  readonly orgId:  string;
  readonly role:   Role;
}

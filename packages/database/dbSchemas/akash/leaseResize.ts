import { DataTypes } from "sequelize";
import { BelongsTo, Column, Default, Model, PrimaryKey, Table } from "sequelize-typescript";

import { Required } from "../decorators/requiredDecorator";
import { Deployment } from "./deployment";

export interface GroupResourceRow {
  cpuUnits: number;
  gpuUnits: number;
  gpuVendor: string | null;
  gpuModel: string | null;
  memoryQuantity: number;
  ephemeralStorageQuantity: number;
  persistentStorageQuantity: number;
  count: number;
  price: number;
}

/**
 * LeaseResize model for Akash
 *
 * A tenant's pending request to resize a lease in place (MsgResizeLease), kept until the provider accepts it (MsgAcceptLeaseResize)
 * or the request is rejected or canceled. Like the chain, it holds at most one request per deployment, and a new request replaces it.
 */
@Table({
  modelName: "leaseResize",
  indexes: [{ unique: true, fields: ["deploymentId"] }]
})
export class LeaseResize extends Model {
  @Required @PrimaryKey @Default(DataTypes.UUIDV4) @Column(DataTypes.UUID) id!: string;
  @Required @Column(DataTypes.UUID) deploymentId!: string;
  @BelongsTo(() => Deployment, { foreignKey: "deploymentId", onDelete: "CASCADE" }) deployment!: Deployment;
  @Required @Column owner!: string;
  @Required @Column dseq!: string;
  @Required @Column gseq!: number;
  @Required @Column oseq!: number;
  @Required @Column bseq!: number;
  @Required @Column provider!: string;
  /**
   * The group's resource units the request asks for, each shaped like a deploymentGroupResource row
   */
  @Required @Column(DataTypes.JSONB) resources!: GroupResourceRow[];
  @Required @Column requestedHeight!: number;
}

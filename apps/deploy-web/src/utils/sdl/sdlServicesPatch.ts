import yaml from "js-yaml";

/** Private registry credentials as the api's patch takes them, whole or cleared. */
export interface ServiceCredentialsPatch {
  host: string;
  username: string;
  password: string;
}

/** The compute of the profile a service runs on, as the api's patch route takes it to resize the service's lease in place. */
export interface ServiceResourcesPatch {
  cpu?: number;
  memory?: string;
  ephemeralStorage?: string;
  gpu?: number;
}

export interface ServiceExposePatch {
  port?: number;
  as?: number;
}

/** The manifest-only fields of one service the api accepts as a partial update, keyed as its patch route spells them. */
export interface ServicePatch {
  image?: string;
  command?: string[] | null;
  args?: string[] | null;
  /** Keyed by variable name; null removes the variable. */
  env?: Record<string, string | null>;
  credentials?: ServiceCredentialsPatch | null;
  /** Keyed by the container port the previous SDL declares, which is how the api addresses an endpoint. */
  expose?: Record<string, ServiceExposePatch>;
  resources?: ServiceResourcesPatch;
  count?: number;
}

/** Keyed by service name; only services with a difference appear. */
export type ServicesPatch = Record<string, ServicePatch>;

interface SdlService {
  image?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  credentials?: unknown;
  expose?: unknown;
}

interface ExposedPorts {
  port: number;
  as: number;
}

interface SdlDocument {
  services: Record<string, SdlService>;
  profiles?: { compute?: Record<string, { resources?: SdlResources }> };
  deployment?: Record<string, Record<string, { profile?: unknown; count?: unknown }>>;
}

interface SdlResources {
  cpu?: { units?: unknown };
  memory?: { size?: unknown };
  storage?: unknown;
  gpu?: { units?: unknown };
}

type ServiceCompute = ServiceResourcesPatch & { count?: number };

/** A service present on only one side is a structural change the patch route does not take, so it is left out. */
export function servicesPatchBetween(previousSdl: string, nextSdl: string): ServicesPatch {
  const previousDocument = documentOf(previousSdl);
  const nextDocument = documentOf(nextSdl);
  const patch: ServicesPatch = {};

  Object.entries(nextDocument.services).forEach(([name, next]) => {
    const previous = previousDocument.services[name];
    if (!previous) return;

    const servicePatch = {
      ...servicePatchBetween(previous, next),
      ...computePatchBetween(computeOf(previousDocument, name), computeOf(nextDocument, name))
    };
    if (Object.keys(servicePatch).length > 0) patch[name] = servicePatch;
  });

  return patch;
}

export function isEmptyServicesPatch(patch: ServicesPatch): boolean {
  return Object.keys(patch).length === 0;
}

function servicePatchBetween(previous: SdlService, next: SdlService): ServicePatch {
  const patch: ServicePatch = {};

  if (typeof next.image === "string" && next.image !== previous.image) patch.image = next.image;

  const command = tokensPatchBetween(previous.command, next.command);
  if (command !== undefined) patch.command = command;

  const args = tokensPatchBetween(previous.args, next.args);
  if (args !== undefined) patch.args = args;

  const env = envPatchBetween(envEntriesOf(previous.env), envEntriesOf(next.env));
  if (Object.keys(env).length > 0) patch.env = env;

  const credentials = credentialsPatchBetween(previous.credentials, next.credentials);
  if (credentials !== undefined) patch.credentials = credentials;

  const expose = exposePatchBetween(exposedPortsOf(previous.expose), exposedPortsOf(next.expose));
  if (Object.keys(expose).length > 0) patch.expose = expose;

  return patch;
}

/** Paired by position, because an endpoint added or removed is structural and the patch route only moves numbers. */
function exposePatchBetween(previous: ExposedPorts[], next: ExposedPorts[]): Record<string, ServiceExposePatch> {
  if (previous.length !== next.length) return {};

  return Object.fromEntries(
    previous.flatMap((before, index) => {
      const after = next[index];
      if (after.port === before.port && after.as === before.as) return [];

      return [[String(before.port), exposeEntryPatchBetween(before, after)]];
    })
  );
}

/** A container port move carries `as` with it, because the api reads an entry that declares none as reached on its new container port. */
function exposeEntryPatchBetween(before: ExposedPorts, after: ExposedPorts): ServiceExposePatch {
  return after.port === before.port ? { as: after.as } : { port: after.port, as: after.as };
}

/** A missing `as` is reached on the container port, so it is read that way and spelling it out never counts as a move. */
function exposedPortsOf(expose: unknown): ExposedPorts[] {
  if (!Array.isArray(expose)) return [];

  return expose.map(entry => {
    const { port, as } = entry as { port?: unknown; as?: unknown };
    return { port: Number(port), as: Number(as || port) };
  });
}

/** `undefined` means unchanged; `null` means the list was removed. */
function tokensPatchBetween(previous: unknown, next: unknown): string[] | null | undefined {
  const previousTokens = tokensOf(previous);
  const nextTokens = tokensOf(next);
  if (JSON.stringify(previousTokens) === JSON.stringify(nextTokens)) return undefined;

  return nextTokens ?? null;
}

function tokensOf(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

function envPatchBetween(previous: Map<string, string>, next: Map<string, string>): Record<string, string | null> {
  const env: Record<string, string | null> = {};

  next.forEach((value, key) => {
    if (previous.get(key) !== value) env[key] = value;
  });
  previous.forEach((_value, key) => {
    if (!next.has(key)) env[key] = null;
  });

  return env;
}

/** A bare `KEY` inherits from the host environment and has no value the patch route could carry, so it is left alone. */
function envEntriesOf(env: unknown): Map<string, string> {
  const entries = new Map<string, string>();
  if (!Array.isArray(env)) return entries;

  env.forEach(entry => {
    if (typeof entry !== "string") return;
    const separatorAt = entry.indexOf("=");
    if (separatorAt === -1) return;
    entries.set(entry.slice(0, separatorAt), entry.slice(separatorAt + 1));
  });

  return entries;
}

function credentialsPatchBetween(previous: unknown, next: unknown): ServiceCredentialsPatch | null | undefined {
  const previousCredentials = credentialsOf(previous);
  const nextCredentials = credentialsOf(next);
  if (JSON.stringify(previousCredentials) === JSON.stringify(nextCredentials)) return undefined;

  return nextCredentials ?? null;
}

function credentialsOf(value: unknown): ServiceCredentialsPatch | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { host, username, password } = value as Record<string, unknown>;

  return { host: String(host ?? ""), username: String(username ?? ""), password: String(password ?? "") };
}

/** Only a value the next SDL holds is patched, since a resize sets amounts and has no way to drop a field. */
function computePatchBetween(previous: ServiceCompute, next: ServiceCompute): Pick<ServicePatch, "resources" | "count"> {
  const resources: ServiceResourcesPatch = {};

  if (next.cpu !== undefined && next.cpu !== previous.cpu) resources.cpu = next.cpu;
  if (next.memory !== undefined && next.memory !== previous.memory) resources.memory = next.memory;
  if (next.ephemeralStorage !== undefined && next.ephemeralStorage !== previous.ephemeralStorage) resources.ephemeralStorage = next.ephemeralStorage;
  if (next.gpu !== undefined && next.gpu !== previous.gpu) resources.gpu = next.gpu;

  return {
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    ...(next.count !== undefined && next.count !== previous.count ? { count: next.count } : {})
  };
}

/** Read through the service's one placement, as the deployment builder writes it; a service placed more than once is no resize the form makes. */
function computeOf(document: SdlDocument, serviceName: string): ServiceCompute {
  const placements = Object.values(document.deployment?.[serviceName] ?? {});
  if (placements.length !== 1) return {};

  const [{ profile, count }] = placements;
  const resources = typeof profile === "string" ? document.profiles?.compute?.[profile]?.resources : undefined;

  return {
    cpu: numberOf(resources?.cpu?.units),
    memory: stringOf(resources?.memory?.size),
    ephemeralStorage: stringOf(ephemeralVolumeOf(resources?.storage)?.size),
    gpu: numberOf(resources?.gpu?.units),
    count: numberOf(count)
  };
}

function ephemeralVolumeOf(storage: unknown): { size?: unknown } | undefined {
  const volumes = (Array.isArray(storage) ? storage : [storage]).filter(
    (volume): volume is { size?: unknown; attributes?: { persistent?: unknown } } => !!volume && typeof volume === "object"
  );
  const ephemeral = volumes.filter(volume => volume.attributes?.persistent !== true && volume.attributes?.persistent !== "true");

  return ephemeral.length === 1 ? ephemeral[0] : undefined;
}

function numberOf(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;

  return Number.isFinite(number) ? number : undefined;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function documentOf(sdl: string): SdlDocument {
  try {
    const document = yaml.load(sdl) as Partial<SdlDocument> | null;
    const services = document?.services;
    const isRecord = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value);

    return {
      services: isRecord(services) ? (services as Record<string, SdlService>) : {},
      profiles: isRecord(document?.profiles) ? document?.profiles : undefined,
      deployment: isRecord(document?.deployment) ? document?.deployment : undefined
    };
  } catch {
    return { services: {} };
  }
}

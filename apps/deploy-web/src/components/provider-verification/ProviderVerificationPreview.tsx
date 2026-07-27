"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem
} from "@akashnetwork/ui/components";
import { Boxes, FlaskConical, Loader2, RadioTower, RefreshCw, Server, ShieldCheck } from "lucide-react";

import { LeaseVerificationView } from "./LeaseVerificationView";
import { defaultVerificationRequirement, mockProviders, REVIEW_NOW } from "./providerVerification.mock";
import type { ProviderVerificationFeed, VerificationRequirement } from "./providerVerification.types";
import { ProviderVerificationDetails } from "./ProviderVerificationDetails";
import { VerificationMarketplace } from "./VerificationMarketplace";
import { VerificationTierGuide } from "./VerificationTierGuide";

type PreviewTab = "marketplace" | "provider" | "lease";
type DataSource = "live" | "scenarios";

interface Props {
  initialDataSource?: DataSource;
}

export function ProviderVerificationPreview({ initialDataSource = "live" }: Props) {
  const [activeTab, setActiveTab] = useState<PreviewTab>("marketplace");
  const [dataSource, setDataSource] = useState<DataSource>(initialDataSource);
  const [requirement, setRequirement] = useState<VerificationRequirement>(defaultVerificationRequirement);
  const [selectedOwner, setSelectedOwner] = useState(mockProviders[1].owner);
  const [liveFeed, setLiveFeed] = useState<ProviderVerificationFeed | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const providers = useMemo(() => (dataSource === "live" ? liveFeed?.providers ?? [] : mockProviders), [dataSource, liveFeed]);
  const now = useMemo(() => (dataSource === "live" && liveFeed ? new Date(liveFeed.observedAt) : REVIEW_NOW), [dataSource, liveFeed]);
  const selectedProvider = providers.find(provider => provider.owner === selectedOwner) ?? providers[0];

  const loadLiveFeed = useCallback(async () => {
    setIsLoadingLive(true);
    setLiveError(null);
    try {
      const response = await fetch("/api/aep86/provider-verification", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Live state request returned ${response.status}`);
      setLiveFeed((await response.json()) as ProviderVerificationFeed);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Unable to load live AEP-86 state");
    } finally {
      setIsLoadingLive(false);
    }
  }, []);

  useEffect(() => {
    if (dataSource === "live" && !liveFeed && !isLoadingLive && !liveError) void loadLiveFeed();
  }, [dataSource, isLoadingLive, liveError, liveFeed, loadLiveFeed]);

  useEffect(() => {
    if (providers.length > 0 && !providers.some(provider => provider.owner === selectedOwner)) setSelectedOwner(providers[0].owner);
  }, [providers, selectedOwner]);

  const inspectProvider = (owner: string) => {
    setSelectedOwner(owner);
    setActiveTab("provider");
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h1 className="text-3xl">Provider verification</h1>
            <Badge variant="outline" className="rounded-md">
              AEP-86 preview
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {dataSource === "live" ? `${liveFeed?.chainId ?? "AEP-86 testnet"} · on-chain provider state` : "Product scenarios · typed review fixtures"}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs uppercase text-muted-foreground">Selected provider</p>
          <p className="mt-1 text-sm font-medium">{selectedProvider?.name ?? "No provider loaded"}</p>
        </div>
      </header>

      <section className="flex flex-col gap-3 border-y py-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          type="single"
          value={dataSource}
          onValueChange={value => {
            if (value === "live" || value === "scenarios") setDataSource(value);
          }}
          aria-label="Provider verification data source"
          variant="outline"
          className="w-full justify-start sm:w-auto"
        >
          <ToggleGroupItem value="live" aria-label="Live testnet" className="flex-1 gap-2 sm:flex-none">
            <RadioTower className="h-4 w-4" aria-hidden="true" /> Live testnet
          </ToggleGroupItem>
          <ToggleGroupItem value="scenarios" aria-label="Product scenarios" className="flex-1 gap-2 sm:flex-none">
            <FlaskConical className="h-4 w-4" aria-hidden="true" /> Product scenarios
          </ToggleGroupItem>
        </ToggleGroup>

        {dataSource === "live" && (
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            {liveFeed && (
              <Badge variant={liveFeed.moduleActive ? "success" : "outline"} className="rounded-md">
                Matching {liveFeed.moduleActive ? "active" : "inactive"}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => void loadLiveFeed()} disabled={isLoadingLive}>
              {isLoadingLive ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
              Refresh
            </Button>
          </div>
        )}
      </section>

      {dataSource === "live" && liveError && (
        <Alert variant="destructive">
          <RadioTower className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Live testnet state is unavailable</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{liveError}</span>
            <Button variant="outline" size="sm" onClick={() => setDataSource("scenarios")}>
              Open product scenarios
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {dataSource === "live" && isLoadingLive && !liveFeed && (
        <div className="flex min-h-[240px] items-center justify-center border-y">
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading AEP-86 testnet state
          </span>
        </div>
      )}

      <VerificationTierGuide />

      {selectedProvider && (
        <Tabs value={activeTab} onValueChange={value => setActiveTab(parsePreviewTab(value))}>
          <TabsList className="grid w-full grid-cols-3 sm:w-auto">
            <TabsTrigger value="marketplace" className="px-3 sm:px-6">
              <Boxes className="mr-2 hidden h-4 w-4 sm:block" aria-hidden="true" /> Bid prescreen
            </TabsTrigger>
            <TabsTrigger value="provider" className="px-3 sm:px-6">
              <ShieldCheck className="mr-2 hidden h-4 w-4 sm:block" aria-hidden="true" /> Provider
            </TabsTrigger>
            <TabsTrigger value="lease" className="px-3 sm:px-6">
              <Server className="mr-2 hidden h-4 w-4 sm:block" aria-hidden="true" /> Active lease
            </TabsTrigger>
          </TabsList>

          <TabsContent value="marketplace" className="mt-4">
            <VerificationMarketplace
              providers={providers}
              requirement={requirement}
              selectedOwner={selectedOwner}
              now={now}
              onRequirementChange={setRequirement}
              onInspect={inspectProvider}
            />
          </TabsContent>
          <TabsContent value="provider" className="mt-4">
            <ProviderVerificationDetails provider={selectedProvider} now={now} />
          </TabsContent>
          <TabsContent value="lease" className="mt-4">
            {selectedProvider.activeLease.kind === "active" ? (
              <LeaseVerificationView provider={selectedProvider} lease={selectedProvider.activeLease} now={now} />
            ) : (
              <section className="flex min-h-[280px] flex-col items-center justify-center border-y px-5 text-center">
                <Server className="mb-4 h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-base font-semibold">No active lease is available</h2>
                <p className="mt-2 max-w-[520px] text-sm text-muted-foreground">This provider currently reports no active leases.</p>
                {dataSource === "live" && (
                  <Button variant="outline" className="mt-5" onClick={() => setDataSource("scenarios")}>
                    Open lease scenario
                  </Button>
                )}
              </section>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function parsePreviewTab(value: string): PreviewTab {
  if (value === "provider" || value === "lease") return value;
  return "marketplace";
}

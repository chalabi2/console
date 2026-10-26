import * as v1 from "@akashnetwork/chain-sdk/private-types/akash.v1";
import * as v1beta4 from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import * as v1beta5 from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import * as cosmosv1 from "@akashnetwork/chain-sdk/private-types/cosmos.v1";
import * as cosmosv1alpha1 from "@akashnetwork/chain-sdk/private-types/cosmos.v1alpha1";
import * as cosmosv1beta1 from "@akashnetwork/chain-sdk/private-types/cosmos.v1beta1";
import * as cosmosv2alpha1 from "@akashnetwork/chain-sdk/private-types/cosmos.v2alpha1";
import type { GeneratedType } from "@cosmjs/proto-signing";
import { Registry } from "@cosmjs/proto-signing";
import type { Provider } from "@nestjs/common";

/** Spread one namespace at a time, as a single spread of all of them makes a union too large for the compiler. */
function registryTypesOf(...namespaces: object[]): Array<[string, GeneratedType]> {
  return namespaces
    .flatMap(namespace => Object.values(namespace))
    .filter(x => "$type" in x)
    .map(x => ["/" + x.$type, x as GeneratedType]);
}

export const RegistryProvider: Provider<Registry> = {
  provide: Registry,
  useFactory: () => {
    const akashTypes: ReadonlyArray<[string, GeneratedType]> = registryTypesOf(v1, v1beta4, v1beta5, cosmosv1, cosmosv1beta1, cosmosv1alpha1, cosmosv2alpha1);

    return new Registry(akashTypes);
  }
};

import { createWithEqualityFn } from 'zustand/traditional';

import {
  createReplicaSlice,
  createReplicaState,
  defineReplica,
  recordLens,
  type ReplicaState,
} from '@/libs/replica';
import { type LocalShopData, localShopsService } from '@/services/localShops';

interface LocalShopsState {
  data: Record<string, LocalShopData>;
  replica: ReplicaState<LocalShopData>;
}
const resource = defineReplica<Record<string, never>, LocalShopData>({
  key: () => 'local',
  name: 'localShops',
  storage: 'indexedDB',
  version: 1,
});
const initialState = (): LocalShopsState => ({ data: {}, replica: createReplicaState() });
export const useLocalShopsStore = createWithEqualityFn<LocalShopsState>()(initialState);
class LocalShopsActions {
  readonly #replica = createReplicaSlice(resource, {
    actionPrefix: 'localShops',
    fetcher: () => localShopsService.command({ action: 'list' }),
    get: useLocalShopsStore.getState,
    set: useLocalShopsStore.setState,
    stateKey: 'replica',
    view: recordLens<LocalShopsState, LocalShopData>('data'),
  });
  useFetch = () => this.#replica.useSync({});
  refresh = () => this.#replica.fetch({}, { fresh: true });
  reset = () => {
    useLocalShopsStore.setState(initialState());
  };
  command = async <T = LocalShopData>(input: Record<string, unknown>): Promise<T> => {
    const result = await localShopsService.command<T>(input);
    await this.refresh();
    return result;
  };
}
export const localShopsActions = new LocalShopsActions();

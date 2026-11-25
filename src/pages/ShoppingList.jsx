// src/pages/ShoppingList.jsx
// The shopping list as its own screen.
//
// It also lives on the Meal Plan page, beside the week that produces half of
// it — that is where you add something you noticed while planning. This is the
// screen you open in the shop, so it gets the full width and nothing else on
// it.
//
// Both surfaces render the same ShoppingList component driven by the same two
// sources, so there is no second copy of the list to drift.

import { Container } from 'react-bootstrap';

import useMealPlan from '../hooks/useMealPlan';
import useShoppingList, { findDuplicateNames } from '../hooks/useShoppingList';
import { ShoppingList as ShoppingListPanel } from '../components/MealPlan';
import { useShoppingListActions } from '../components/MealPlan/useShoppingListActions';
import useStores from '../stores/useStores';
import { useToast } from '../components/Common';

const ShoppingListPage = () => {
  // The derived half. useMealPlan is the only thing that computes it, and
  // asking it again here rather than recomputing keeps one definition of what
  // the week still needs.
  const { shoppingList, setDerivedBought } = useMealPlan();
  const { items: manualItems } = useShoppingList();
  const actions = useShoppingListActions({ setDerivedBought });
  const storesApi = useStores();
  const { showError } = useToast();
  const report = (result) => {
    if (result && !result.success) showError(result.error);
    return result;
  };

  const duplicateNames = findDuplicateNames(manualItems, shoppingList);

  return (
    <Container fluid className="px-0">
      <h1 className="h4 mb-3">Shopping List</h1>
      <ShoppingListPanel
        items={shoppingList}
        manualItems={manualItems}
        duplicateNames={duplicateNames}
        {...actions}
        stores={storesApi.stores}
        storeOf={storesApi.storeOf}
        usualStore={storesApi.usualStore}
        onSetStore={(item, store) => storesApi.setStore(item, store).then(report)}
        onAddStore={storesApi.addStore}
        onRemoveStore={(id) => storesApi.removeStore(id).then(report)}
      />
    </Container>
  );
};

export default ShoppingListPage;

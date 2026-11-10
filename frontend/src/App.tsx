import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AdminPage } from './components/admin/AdminPage';
import { CheckoutPage } from './components/customer/CheckoutPage';
import { HomePage } from './components/customer/HomePage';
import { NotFoundPage } from './components/customer/NotFoundPage';
import { TrackingLinkPage } from './components/customer/TrackingLinkPage';
import type { CartLine } from './types';
import { cartStorageKey, checkoutKeyStorageKey, readCart } from './utils';

export default function App() {
  const [cart, setCart] = useState<CartLine[]>(readCart);
  const [cartStorageError, setCartStorageError] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(cartStorageKey, JSON.stringify(cart));
      setCartStorageError(null);
    } catch (error) {
      console.error('Could not save the cart:', error);
      setCartStorageError('Your cart could not be saved in this browser.');
    }
  }, [cart]);

  function addToCart(productId: string) {
    setCart((current) => {
      const existing = current.find((item) => item.productId === productId);
      if (existing) {
        return current.map((item) =>
          item.productId === productId
            ? { ...item, quantity: Math.min(item.quantity + 1, 50) }
            : item,
        );
      }
      return [...current, { productId, quantity: 1 }];
    });
  }

  function updateQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      setCart((current) => current.filter((item) => item.productId !== productId));
      return;
    }
    setCart((current) =>
      current.map((item) =>
        item.productId === productId ? { ...item, quantity: Math.min(quantity, 50) } : item,
      ),
    );
  }

  function removeFromCart(productId: string) {
    setCart((current) => current.filter((item) => item.productId !== productId));
  }

  function clearCartAfterOrder() {
    setCart([]);
    try {
      window.localStorage.removeItem(checkoutKeyStorageKey);
    } catch (error) {
      console.error('Could not clear the saved checkout key:', error);
      setCartStorageError('Your order was placed, but browser storage could not be cleared.');
    }
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <HomePage
            cart={cart}
            addToCart={addToCart}
            updateQuantity={updateQuantity}
            cartStorageError={cartStorageError}
          />
        }
      />
      <Route
        path="/checkout"
        element={
          <CheckoutPage
            cart={cart}
            updateQuantity={updateQuantity}
            removeFromCart={removeFromCart}
            onOrderPlaced={clearCartAfterOrder}
            cartStorageError={cartStorageError}
          />
        }
      />
      <Route path="/track/:token" element={<TrackingLinkPage />} />
      <Route path="/admin/*" element={<AdminPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

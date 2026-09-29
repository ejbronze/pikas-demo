import { CafeteriaProducts } from '@/components/cafeteria-products';
import { MenuAdmin } from '@/components/admin-pages';
import { isDemoMode } from '@/lib/env';

export default function Page() {
  return isDemoMode() ? <CafeteriaProducts /> : <MenuAdmin />;
}

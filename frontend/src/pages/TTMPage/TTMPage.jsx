import { useEffect, useRef } from 'react';
import { useParams, useLocation, useOutletContext } from 'react-router-dom';
import TTMGrid from '../../components/TTMGrid/TTMGrid';

export default function TTMPage() {
  const { ttm_id }     = useParams();
  const location       = useLocation();
  const { setCurrentTtm, setTtmActions } = useOutletContext();
  const gridRef        = useRef(null);
  const ttmIdNum       = parseInt(ttm_id, 10);
  const ttmNameFromNav = location.state?.ttm_name ?? null;

  useEffect(() => {
    setCurrentTtm({ ttm_id: ttmIdNum, ttm_name: ttmNameFromNav });
    setTtmActions({
      addTask:            () => gridRef.current?.addTask(),
      openResourcePicker: () => gridRef.current?.openResourcePicker(),
      openReorder:        (type) => gridRef.current?.openReorder(type),
    });
    return () => {
      setCurrentTtm(null);
      setTtmActions(null);
    };
  }, [ttmIdNum, ttmNameFromNav, setCurrentTtm, setTtmActions]);

  return <TTMGrid ref={gridRef} key={ttmIdNum} ttm_id={ttmIdNum} />;
}

import React, { memo } from 'react';
import { cn, ESSENCE } from '@/lib/essence';

interface PageProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export const Page = memo(({ className, padded = true, children, ...rest }: PageProps) => {
  return (
    <div
      className={cn(
        'min-h-screen w-full',
        ESSENCE.tw.surface.subtle,
        padded ? 'px-4 md:px-6 py-6' : '',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

Page.displayName = 'Page';

export default Page;

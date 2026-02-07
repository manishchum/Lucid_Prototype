
// import React from 'react';

// interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
//   children: React.ReactNode;
//   variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
//   size?: 'sm' | 'md' | 'lg';
//   className?: string;
// }

// const Button: React.FC<ButtonProps> = ({
//   children,
//   variant = 'primary',
//   size = 'md',
//   className = '',
//   ...props
// }) => {
//   const baseStyles = 'font-bold py-2 px-4 rounded-lg transition ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2';

//   const variantStyles = {
//     primary: 'bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500',
//     secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800 focus:ring-gray-400',
//     danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
//     ghost: 'bg-transparent hover:bg-gray-100 text-gray-800 focus:ring-gray-400',
//   };

//   const sizeStyles = {
//     sm: 'text-sm py-1.5 px-3',
//     md: 'text-base py-2 px-4',
//     lg: 'text-lg py-3 px-6',
//   };

//   return (
//     <button
//       className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
//       {...props}
//     >
//       {children}
//     </button>
//   );
// };

// export default Button;

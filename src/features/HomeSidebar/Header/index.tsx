'use client';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import Nav from './components/Nav';
import User from './components/User';

const Header = () => {
  return (
    <>
      <SideBarHeaderLayout left={<User />} showBack={false} />
      <Nav />
    </>
  );
};

export default Header;

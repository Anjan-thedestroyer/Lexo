"use client"
import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import './Navbar.css';
import axiosInstance from '../utils/axios.js';

const Navbar = ({ color  }) => {
  const [sticky, setSticky] = useState(false);
  const [isLogged, setIsLogged] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [hostel, setHostel] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isFreelancer, setIsFreelancer] = useState(false)
  const [taskCount, setTaskCount] = useState(0)
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => {
      setSticky(window.scrollY > 500 || color === 'no');
    }

    window.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [color]);

  useEffect(() => {
    const checkLoginStatus = () => {
      const token = localStorage.getItem('accessToken');
      setIsLogged(!!token);

    };

    checkLoginStatus();
    const getData = async () => {
      try {
        const response = await axiosInstance.get('/user/user-details');
        const hostelData = response.data?.data?.hostel;
        const status = response.data?.data?.role;
        const task = response.data?.data?.task
        if (Array.isArray(task) && task.length > 0) {
          setTaskCount(task.length);
        } else {
          setTaskCount(0);
        }

        if (Array.isArray(hostelData) && hostelData.length > 0 && hostelData[0] !== null) {
          setHostel(true);
        } else {
          setHostel(false);
        }

        if (status === 'ADMIN') {
          setIsAdmin(true);
          const stat = 'IsAdmin';
          localStorage.setItem('status', stat);
        } else {
          setIsAdmin(false);
        }

        if (status === "Freelancer") {
          setIsFreelancer(true)
        } else {
          setIsFreelancer(false);
        }

      } catch (error) {
        console.error("Failed to fetch user details:", error);
        setHostel(false);
      }
    };

    getData();
    window.addEventListener('auth-change', checkLoginStatus);
    return () => {
      window.removeEventListener('auth-change', checkLoginStatus);
    };
  }, []);

  const toggleMenu = () => {
    setMobileMenu(prev => !prev);
  };

  const removeToken = async () => {
    try {
      await axiosInstance.get('/user/logout');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('status');
      localStorage.removeItem('myData');
      window.location.href = '/';
      window.dispatchEvent(new Event('auth-change'));
      navigate('/');
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <>
      <Helmet>
        <link rel="canonical" href={window.location.href} />
      </Helmet>

      <header >
        <nav className={`container ${sticky ? 'dark-nav' : ''}`}>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
              setMobileMenu(false);
            }}
            aria-label="Home"
            className="logo-link"
          >
            <img
              src={logo}
              alt="Company Logo - Return to Homepage"
              className='logo'
            />
          </a>


          <img
            src={menu_icon}
            alt=""
            aria-hidden="true"
            className="menu-toggle menu-icon"
            onClick={toggleMenu}
            aria-expanded={mobileMenu}
            aria-label="Toggle navigation menu"
          />


          <ul className={mobileMenu ? 'nav-menu' : 'nav-menu hide-mobile-menu'}>
            <li>
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/');
                  setMobileMenu(false);
                }}
                className="nav-link"
              >
                Home
              </a>
            </li>

            {hostel && (
              <li>
                <a
                  href="/control-hostel"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/control-hostel');
                    setMobileMenu(false);
                  }}
                  className="nav-link"
                >
                  My Hostel
                </a>
              </li>
            )}

            <li>
              <Link
                to='about'
                smooth={true}
                offset={0}
                duration={500}
                onClick={() => setMobileMenu(false)}
                className="nav-link"
                aria-label="About Us section"
              >
                About Us
              </Link>
            </li>

            {(isAdmin) && (
              <li>
                <a
                  href="/unverified"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/unverified');
                    setMobileMenu(false);
                  }}
                  className="nav-link"
                >
                  Verify
                </a>
              </li>
            )}
            {(isAdmin) && (
              <li>
                <a
                  href="/unverified"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/list-freelancer');
                    setMobileMenu(false);
                  }}
                  className="nav-link"
                >
                  List-freelancer
                </a>
              </li>
            )}
            {isFreelancer && (
              <li>
                <a
                  href="/task-req"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/task-req');
                    setMobileMenu(false);
                  }}
                  className="nav-link"
                >
                  Works
                  {taskCount > 0 && <span className="task-badge">{taskCount}</span>}
                </a>
              </li>
            )}


            {isAdmin && (
              <li>
                <a
                  href="/list-buyer"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/list-buyer');
                    setMobileMenu(false);
                  }}
                  className="nav-link"
                >
                  Buyers
                </a>
              </li>
            )}

            <li>
              {isLogged ? (
                <button
                  onClick={removeToken}
                  className='btn nav-btn'
                  aria-label="Logout"
                >
                  Logout
                </button>

              ) : (

                <button
                  onClick={() => {
                    navigate('/login');
                    setMobileMenu(false);
                  }}
                  className='btn nav-btn'
                  aria-label="Login"
                >
                  Login
                </button>
              )}
            </li>
          </ul>
        </nav>
      </header>
    </>
  );
};

export default Navbar;
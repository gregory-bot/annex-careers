# This script sets up the environment and runs Airflow with the correct PYTHONPATH and .env loading

import os
import sys
from dotenv import load_dotenv

# Set the workspace root and airflow-home directory
BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_ROOT)
AIRFLOW_HOME = os.path.join(BACKEND_ROOT, 'airflow_home')

# Load .env file
load_dotenv(os.path.join(PROJECT_ROOT, '.env'))

    # Add airflow_home to PYTHONPATH
if AIRFLOW_HOME not in sys.path:
    sys.path.insert(0, AIRFLOW_HOME)

# Run Airflow scheduler and webserver
os.system('airflow db upgrade')
os.system('airflow scheduler &')
os.system('airflow webserver &')

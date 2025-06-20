// HBVU PHOTOS API Service
// Handles all communication with the HBVU PHOTOS Express API

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://vault-api.hbvu.su'

class ApiService {
  constructor() {
    this.authService = null // Will be set by auth service
  }

  // Set auth service reference (to avoid circular imports)
  setAuthService(authService) {
    this.authService = authService
  }

  // Get authentication token
  getAuthToken() {
    return localStorage.getItem('hbvu_auth_token')
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`
    
    // DEBUG: Log the actual API URL being called
    console.log('🌐 API Call:', url)
    
    // Add authentication headers
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    // Add auth token if available
    const token = this.getAuthToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    
    const config = {
      headers,
      ...options,
    }

    try {
      const response = await fetch(url, config)
      
      // Handle 401 Unauthorized - token might be expired
      if (response.status === 401) {
        console.warn('Authentication failed - clearing tokens and redirecting to login');
        
        // Clear invalid token
        localStorage.removeItem('hbvu_auth_token')
        localStorage.removeItem('hbvu_user_data')
        
        // Clear auth service state if available
        if (this.authService) {
          this.authService.clearAuth()
        }
        
        // Force page reload to show login screen
        setTimeout(() => {
          window.location.reload();
        }, 100);
        
        throw new Error('Invalid or expired token')
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! status: ${response.status}` }))
        throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`)
      }
      
      return await response.json()
    } catch (error) {
      throw error
    }
  }

  // Health check
  async getHealth() {
    return this.request('/health')
  }

  // Bucket operations
  async getBuckets() {
    return this.request('/buckets')
  }

  async getBucketStats(bucketName) {
    return this.request(`/buckets/${bucketName}/stats`)
  }

  async createBucket(bucketName) {
    return this.request('/buckets', {
      method: 'POST',
      body: JSON.stringify({ bucketName })
    })
  }

  // Folder/Object operations
  async getBucketContents(bucketName, prefix = '', options = {}) {
    const endpoint = prefix 
      ? `/buckets/${bucketName}/objects?prefix=${encodeURIComponent(prefix)}`
      : `/buckets/${bucketName}/objects`
    return this.request(endpoint, options)
  }

  async createFolder(bucketName, folderPath) {
    return this.request(`/buckets/${bucketName}/folders`, {
      method: 'POST',
      body: JSON.stringify({ folderPath })
    })
  }

  async deleteFolder(bucketName, folderPath) {
    return this.request(`/buckets/${bucketName}/folders`, {
      method: 'DELETE',
      body: JSON.stringify({ folderPath })
    })
  }

  // File upload - Updated to match API spec
  async uploadFile(bucketName, files, folderPath = '') {
    const formData = new FormData()
    
    // Add files to form data
    if (Array.isArray(files)) {
      files.forEach(file => {
        formData.append('files', file)
      })
    } else {
      formData.append('files', files)
    }
    
    // Add folder path if provided
    if (folderPath) {
      formData.append('folderPath', folderPath)
    }
    
    const url = `${API_BASE_URL}/buckets/${bucketName}/upload`
    
    // Prepare headers (don't set Content-Type for FormData)
    const headers = {}
    
    // Add auth token if available
    const token = this.getAuthToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      return await response.json()
    } catch (error) {
      throw error
    }
  }

  // Single file upload with progress tracking
  async uploadSingleFile(bucketName, file, folderPath = '', onProgress = null) {
    const formData = new FormData()
    formData.append('files', file)
    
    if (folderPath) {
      formData.append('folderPath', folderPath)
    }
    
    const url = `${API_BASE_URL}/buckets/${bucketName}/upload`
    
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      
      // Track upload progress
      if (onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percentComplete = (event.loaded / event.total) * 100
            onProgress(percentComplete)
          }
        })
      }
      
      // Handle completion
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText)
            resolve(response)
          } catch (error) {
            reject(new Error('Invalid JSON response'))
          }
        } else {
          reject(new Error(`HTTP error! status: ${xhr.status}`))
        }
      })
      
      // Handle errors
      xhr.addEventListener('error', () => {
        reject(new Error('Network error occurred'))
      })
      
      // Start the upload - MUST be called before setting headers
      xhr.open('POST', url)
      
      // Add auth header if available - AFTER xhr.open()
      const token = this.getAuthToken()
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      }
      
      xhr.send(formData)
    })
  }

  // Delete object - This endpoint doesn't exist in your API
  // async deleteObject(bucketName, objectName) {
  //   return this.request(`/buckets/${bucketName}/objects/${encodeURIComponent(objectName)}`, {
  //     method: 'DELETE'
  //   })
  // }

  // Object URL generation for downloading/viewing files
  getObjectUrl(bucketName, objectName) {
    return `${API_BASE_URL}/buckets/${bucketName}/download?object=${encodeURIComponent(objectName)}`
  }

  // **PHASE 3: Job Status API Methods**
  
  // Get job status
  async getJobStatus(jobId) {
    try {
      const response = await this.request(`/upload/status/${jobId}`)
      return response
    } catch (error) {
      throw error
    }
  }

  // Poll job status with automatic retries
  async pollJobStatus(jobId, onUpdate = null, maxAttempts = 60, intervalMs = 2000) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      
      const poll = async () => {
        try {
          attempts++;
          const response = await this.getJobStatus(jobId);
          
          if (response.success && response.data) {
            const job = response.data;
            
            // Call update callback if provided
            if (onUpdate) {
              onUpdate(job);
            }
            
            // Check if job is complete
            if (job.status === 'completed' || job.status === 'failed') {
              resolve(job);
              return;
            }
            
            // Continue polling if not complete and under max attempts
            if (attempts < maxAttempts) {
              setTimeout(poll, intervalMs);
            } else {
              reject(new Error(`Job polling timeout after ${maxAttempts} attempts`));
            }
          } else {
            reject(new Error('Invalid job status response'));
          }
        } catch (error) {
          // If job not found or other error, stop polling
          if (error.message.includes('404') || error.message.includes('not found')) {
            reject(new Error('Job not found'));
          } else if (attempts >= maxAttempts) {
            reject(error);
          } else {
            // Retry on network errors
            setTimeout(poll, intervalMs);
          }
        }
      };
      
      // Start polling
      poll();
    });
  }
}

export default new ApiService()

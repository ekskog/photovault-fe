<template>
  <div class="album-detail">
    <!-- Header -->
    <div class="album-header">
      <button class="btn-back" @click="$emit('back')">
        <i class="fas fa-arrow-left"></i> Back to Albums
      </button>
      <div class="album-info">
        <h1><i class="fas fa-folder-open"></i> {{ albumName }}</h1>
        <p class="subtitle">{{ visiblePhotos.length }} photos</p>
      </div>
      <button 
        v-if="canUploadPhotos"
        class="btn-primary" 
        @click="showUploadDialog = true"
      >
        <i class="fas fa-plus"></i> Add Photos
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading">
      <div class="spinner"></div>
      <p>Loading album photos...</p>
    </div>

    <!-- Error State -->
    <div v-if="error" class="error">
      <p><i class="fas fa-exclamation-triangle"></i> {{ error }}</p>
      <button class="btn-secondary" @click="loadPhotos">Try Again</button>
    </div>

    <!-- Photos Grid -->
    <div v-if="!loading && !error" class="photos-section">
      <!-- Empty State -->
      <div v-if="visiblePhotos.length === 0" class="empty-state">
        <div class="empty-icon"><i class="fas fa-images"></i></div>
        <h3>No Photos Yet</h3>
        <p>Start building your album by adding some photos!</p>
        <button 
          v-if="canUploadPhotos"
          class="btn-primary" 
          @click="showUploadDialog = true"
        >
          <i class="fas fa-plus"></i> Add Photos
        </button>
      </div>

      <!-- Photos Grid -->
      <div v-else class="photos-grid">
        <div 
          v-for="photo in paginatedVisiblePhotos" 
          :key="photo.name"
          class="photo-card"
          @click="openPhoto(photo)"
        >
          <div class="photo-thumbnail">
            <!-- All images in grid are now pre-processed (thumbnails for HEIC, originals for others) -->
            <img 
              :src="getOptimizedPhotoUrl(photo)" 
              :alt="photo.name" 
              @error="handleImageError"
              @load="handleImageLoad"
              @loadstart="handleImageLoadStart"
              class="photo-image"
              loading="lazy"
              :data-full-src="getPhotoUrl(photo)"
            >
            
            <!-- Status indicators removed - backend handles conversion -->
            
            <!-- Loading placeholder for images -->
            <div class="image-loading-placeholder">
              <i class="fas fa-image"></i>
            </div>
          </div>
          <div class="photo-info">
            <span class="photo-size">{{ formatFileSize(photo.size) }}</span>
          </div>
        </div>

        <!-- Load More Trigger (Invisible) -->
        <div class="load-more-trigger" v-if="paginatedVisiblePhotos.length < visiblePhotos.length"></div>
      </div>
    </div>

    <!-- Preloading Progress Indicator -->
    <div v-if="!loading && !error && visiblePhotos.length > 0" class="preload-status">
      <div class="preload-header">
        <i class="fas fa-download"></i>
        <span>Lightbox Ready: {{ preloadStats.preloaded }}/{{ preloadStats.thumbnails }}</span>
        <div class="preload-percentage">{{ preloadStats.percentage }}%</div>
      </div>
      <div class="preload-progress-bar">
        <div 
          class="preload-progress-fill" 
          :style="{ width: preloadStats.percentage + '%' }"
        ></div>
      </div>
      <div class="preload-details">
        <!-- Currently Fetching Display -->
        <span v-if="preloadStats.currentlyFetchingFullSize" class="preload-current-file">
          <i class="fas fa-download fa-pulse"></i>
          Fetching full-size AVIF: {{ getPhotoDisplayName(preloadStats.currentlyFetchingFullSize) }}
        </span>
        <span v-else-if="preloadStats.percentage < 100" class="preload-status-text">
          <i class="fas fa-sync fa-spin"></i> Background preloading full-size images for instant lightbox...
        </span>
        <span v-else-if="preloadStats.percentage >= 100" class="preload-complete-text">
          <i class="fas fa-check-circle"></i> All images ready! Lightbox will be instant.
        </span>
        
        <!-- Ready Images List -->
        <div v-if="preloadStats.readyImages.length > 0" class="preload-ready-list">
          <div class="ready-list-header">
            <i class="fas fa-check-circle"></i>
            <span>Full-size images ready for instant lightbox ({{ preloadStats.readyImages.length }}):</span>
          </div>
          <div class="ready-images-grid">
            <span 
              v-for="readyImage in preloadStats.readyImages" 
              :key="readyImage"
              class="ready-image-item"
              :title="readyImage"
            >
              {{ getPhotoDisplayName(readyImage) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Upload Dialog -->
    <div v-if="showUploadDialog" class="dialog-overlay" @click="closeUploadDialog">
      <div class="dialog upload-dialog" @click.stop>
        <h3><i class="fas fa-cloud-upload-alt"></i> Upload Photos</h3>
        
        <!-- File Drop Zone -->
        <div 
          class="upload-zone"
          :class="{ 'dragging': isDragging }"
          @drop="handleDrop"
          @dragover.prevent
          @dragenter="isDragging = true"
          @dragleave="isDragging = false"
          @click="triggerFileInput"
        >
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            multiple
            @change="handleFileSelect"
            style="display: none;"
          />
          <div class="upload-content">
            <i class="fas fa-cloud-upload-alt upload-icon"></i>
            <p class="upload-text">
              Drag and drop photos here or click to select
            </p>
            <p class="upload-hint">
              Supports JPG, PNG, GIF, HEIC files (optimized for fast display)
            </p>
          </div>
        </div>

        <!-- Upload Progress -->
        <div v-if="uploading" class="upload-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: `${uploadProgress}%` }"></div>
          </div>
          <p class="progress-text">{{ uploadStatus }}</p>
        </div>

        <!-- Selected Files -->
        <div v-if="selectedFiles.length > 0" class="selected-files">
          <h4>Selected Files ({{ selectedFiles.length }})</h4>
          <div class="file-list">
            <div v-for="(file, index) in selectedFiles" :key="index" class="file-item">
              <div class="file-info">
                <span class="file-name">{{ file.name }}</span>
                <span class="file-size">{{ formatFileSize(file.size) }}</span>
              </div>
              
              <!-- Individual file progress -->
              <div v-if="uploading" class="file-progress">
                <div v-if="fileUploadProgress[file.name] === -1" class="file-status error">
                  <i class="fas fa-exclamation-triangle"></i>
                  <span>Failed</span>
                </div>
                <div v-else-if="uploadedFiles.has(file.name)" class="file-status success">
                  <i class="fas fa-check"></i>
                  <span>Complete</span>
                </div>
                <div v-else-if="fileUploadProgress[file.name] > 0" class="file-status uploading">
                  <div class="mini-progress-bar">
                    <div class="mini-progress-fill" :style="{ width: `${fileUploadProgress[file.name]}%` }"></div>
                  </div>
                  <span>{{ Math.round(fileUploadProgress[file.name]) }}%</span>
                </div>
                <div v-else class="file-status waiting">
                  <i class="fas fa-clock"></i>
                  <span>Waiting</span>
                </div>
              </div>
              
              <button v-if="!uploading" @click="removeFile(index)" class="btn-remove">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="dialog-actions">
          <button class="btn-secondary" @click="closeUploadDialog" :disabled="uploading">
            Cancel
          </button>
          <button 
            class="btn-primary" 
            @click="uploadPhotos"
            :disabled="selectedFiles.length === 0 || uploading"
          >
            {{ uploading ? 'Uploading...' : `Upload ${selectedFiles.length} Photo${selectedFiles.length !== 1 ? 's' : ''}` }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Photo Confirmation -->
    <div v-if="showDeletePhotoDialog" class="dialog-overlay" @click="closeDeletePhotoDialog">
      <div class="dialog" @click.stop>
        <h3>Delete Photo</h3>
        <p>Are you sure you want to delete "<strong>{{ getPhotoDisplayName(photoToDelete?.name) }}</strong>"?</p>
        <p class="warning"><i class="fas fa-exclamation-triangle"></i> This action cannot be undone.</p>
        <div class="dialog-actions">
          <button class="btn-secondary" @click="closeDeletePhotoDialog">Cancel</button>
          <button 
            class="btn-danger" 
            @click="deletePhoto"
            :disabled="deletingPhoto"
          >
            {{ deletingPhoto ? 'Deleting...' : 'Delete Photo' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Lightbox Viewer -->
    <div v-if="showLightbox" class="lightbox-overlay" @click="closeLightbox">
      <div class="lightbox-container" @click.stop>
        <!-- Navigation Controls -->
        <button 
          class="lightbox-nav lightbox-prev" 
          @click.stop="previousPhoto"
          :disabled="currentPhotoIndex === 0"
          title="Previous Photo (←)"
        >
          <i class="fas fa-chevron-left"></i>
        </button>
        
        <button 
          class="lightbox-nav lightbox-next" 
          @click.stop="nextPhoto"
          :disabled="currentPhotoIndex === lightboxPhotos.length - 1"
          title="Next Photo (→)"
        >
          <i class="fas fa-chevron-right"></i>
        </button>

        <!-- Close Button -->
        <button class="lightbox-close" @click.stop="closeLightbox" title="Close (Esc)">
          <i class="fas fa-times"></i>
        </button>

        <!-- Photo Display -->
        <div class="lightbox-content">
          <div class="lightbox-image-container">
            <!-- Backend handles all conversions -->
            <img 
              v-if="currentPhoto"
              :src="getPhotoUrl(currentPhoto)" 
              :alt="currentPhoto.name"
              class="lightbox-image"
              @error="handleLightboxImageError"
              @load="handleLightboxImageLoad"
            >
            
            <!-- Loading placeholder -->
            <div v-if="lightboxLoading" class="lightbox-loading">
              <i class="fas fa-spinner fa-spin"></i>
              <p>Loading image...</p>
            </div>
          </div>

          <!-- Photo Info -->
          <div class="lightbox-info">
            <div class="lightbox-photo-details">
              <p class="lightbox-photo-meta">
                {{ currentPhotoIndex + 1 }} of {{ lightboxPhotos.length }}
              </p>
            </div>
            
            <!-- Action Buttons -->
            <div class="lightbox-actions">
              <button 
                @click="downloadPhoto(currentPhoto)" 
                class="btn-lightbox-action"
                title="Download Photo"
              >
                <i class="fas fa-download"></i>
              </button>
              <button 
                v-if="canDeletePhoto"
                @click="confirmDeletePhoto(currentPhoto)" 
                class="btn-lightbox-action btn-danger-action"
                title="Delete Photo"
              >
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import apiService from '../services/api.js'
import authService from '../services/auth.js'
import { debugLightbox, debugGallery, debugApi, debugPerformance, debugError } from '../services/debug.js'

// Props
const props = defineProps({
  albumName: {
    type: String,
    required: true
  }
})

// Emits
const emit = defineEmits(['back', 'photoOpened'])

// Reactive state
const loading = ref(false)
const error = ref(null)
const photos = ref([])
// Removed HEIC conversion variables - backend handles all conversions
const showUploadDialog = ref(false)
const showDeletePhotoDialog = ref(false)
const selectedFiles = ref([])
const uploading = ref(false)
const uploadProgress = ref(0)
const uploadStatus = ref('')
const fileUploadProgress = ref({}) // Track individual file progress
const uploadedFiles = ref(new Set()) // Track completed uploads
const failedFiles = ref(new Set()) // Track failed uploads
const isDragging = ref(false)
const photoToDelete = ref(null)
const deletingPhoto = ref(false)
const fileInput = ref(null)

// Lightbox state
const showLightbox = ref(false)
const currentPhotoIndex = ref(0)
const lightboxLoading = ref(false)
const currentImageInfo = ref('')

// Progressive loading stats
const preloadStats = ref({
  thumbnails: 0,
  preloaded: 0,
  percentage: 0,
  currentlyFetchingFullSize: null, // Track full-size filename currently being fetched
  readyImages: [] // List of full-size filenames ready for instant lightbox
})

// Progress tracker interval reference for cleanup
const progressTracker = ref(null)

// Computed properties
const currentPhoto = computed(() => {
  const photo = lightboxPhotos.value[currentPhotoIndex.value] || null
  
  // DEBUG: Log current file showing in lightbox
  if (photo) {
    debugLightbox('Current file showing in lightbox', {
      name: photo.name,
      size: photo.size,
      type: photo.name.split('.').pop().toUpperCase(),
      index: currentPhotoIndex.value,
      totalFiles: lightboxPhotos.value.length
    })
  }
  
  return photo
})

// Permission checks
const canUploadPhotos = computed(() => {
  return authService.canPerformAction('upload_photos')
})

const canDeletePhoto = computed(() => {
  return authService.canPerformAction('delete_photo')
})

// Constants
const BUCKET_NAME = 'photovault'
const ITEMS_PER_PAGE = 50

// Methods
const loadPhotos = async () => {
  console.log('🔄 Loading album:', props.albumName)
  loading.value = true
  error.value = null
  
  // Clear previous data
  cleanupBlobUrls()
  
  try {
    // Clean the album name and ensure we have exactly one trailing slash
    let cleanAlbumName = props.albumName.trim()
    // Remove any trailing slashes first
    cleanAlbumName = cleanAlbumName.replace(/\/+$/, '')
    // Add exactly one trailing slash
    const prefix = cleanAlbumName + '/'
    
    console.log('📡 API request for prefix:', prefix)
    const response = await apiService.getBucketContents(BUCKET_NAME, prefix)
    
    console.log('📥 API response:', response)
    
    if (response.success && response.data) {
      
      // Load ALL files returned by backend (no filtering)
      const allFiles = (response.data.objects || []).filter(obj => {
        // Only exclude folders (names ending with '/')
        return obj.name && !obj.name.endsWith('/');
      })
      
      console.log('📁 Files found:', allFiles.length, allFiles.map(f => f.name))
      
      photos.value = allFiles
      
      // Reset pagination
      resetVirtualScrolling()
      
      console.log('✅ Album loaded successfully')
    } else {
      throw new Error(response.error || 'Failed to load album photos')
    }
  } catch (err) {
    console.error('❌ Error loading photos:', err)
    error.value = `Error loading photos: ${err.message}`
  } finally {
    loading.value = false
  }
}

const downloadPhoto = (photo) => {
  const downloadUrl = apiService.getObjectUrl(BUCKET_NAME, photo.name)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = getPhotoDisplayName(photo.name)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

const getPhotoUrl = (photo) => {
  // If this is a thumbnail file, get the corresponding full-size file for lightbox
  if (/_thumbnail\.avif$/i.test(photo.name)) {
    const fullSizeFilename = photo.name.replace(/_thumbnail\.avif$/i, '_full.avif')
    const url = apiService.getObjectUrl(BUCKET_NAME, fullSizeFilename)
    
    debugGallery('FULL_URL_FROM_THUMBNAIL', `Generated full-size URL from thumbnail ${photo.name}:`, {
      thumbnailFile: photo.name,
      fullSizeFile: fullSizeFilename,
      generatedUrl: url,
      expectedSize: '~4.5MB',
      purpose: 'lightbox-and-preloading'
    })
    
    return url
  }
  
  // If this is already a full-size file, use it directly
  const isFullSizeAvif = /_full\.avif$/i.test(photo.name)
  const url = apiService.getObjectUrl(BUCKET_NAME, photo.name)
  
  debugGallery('FULL_URL_DIRECT', `Using full-size file directly for ${photo.name}:`, {
    fileName: photo.name,
    isFullSizeAvif: isFullSizeAvif,
    generatedUrl: url,
    fileSize: photo.size
  })
  
  return url
}

const getOptimizedPhotoUrl = (photo) => {
  // Since visiblePhotos now contains only thumbnail files, use them directly
  const url = apiService.getObjectUrl(BUCKET_NAME, photo.name)
  debugGallery('THUMBNAIL_URL_DIRECT', `Using thumbnail file directly for ${photo.name}:`, {
    fileName: photo.name,
    generatedUrl: url,
    expectedSize: '~50KB',
    strategy: 'direct-thumbnail-usage'
  })
  return url
}

const preloadImage = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

const loadImageProgressively = async (photo, imgElement) => {
  try {
    debugGallery('PROGRESSIVE_LOADING_START', `Starting progressive load for ${photo.name}`, {
      photoName: photo.name,
      elementId: imgElement.dataset.id || 'unknown'
    })
    
    // Step 1: Thumbnail is already loading via img src attribute (fast ~50KB)
    const optimizedSrc = getOptimizedPhotoUrl(photo)
    
    // Step 2: Start preloading full resolution in background for instant lightbox (slow ~4.5MB)
    const fullSrc = getPhotoUrl(photo)
    if (fullSrc !== optimizedSrc) {
      // Convert thumbnail filename to full-size filename for display
      const fullSizeFilename = photo.name.replace(/_thumbnail\.avif$/i, '_full.avif')
      
      debugGallery('BACKGROUND_PRELOAD_START', `Starting background preload for ${photo.name}`, {
        thumbnailUrl: optimizedSrc,
        fullUrl: fullSrc,
        fullSizeFilename: fullSizeFilename,
        strategy: 'parallel-loading'
      })
      
      // Set currently fetching full-size filename (not thumbnail)
      preloadStats.value.currentlyFetchingFullSize = fullSizeFilename
      
      preloadImage(fullSrc).then(() => {
        // Step 3: Mark as ready for instant lightbox display
        imgElement.dataset.fullLoaded = 'true'
        
        // Add to ready images list if not already there
        if (!preloadStats.value.readyImages.includes(fullSizeFilename)) {
          preloadStats.value.readyImages.push(fullSizeFilename)
        }
        
        debugGallery('BACKGROUND_PRELOAD_SUCCESS', `Background preload complete for ${photo.name}`, {
          fullUrl: fullSrc,
          fullSizeFilename: fullSizeFilename,
          lightboxReady: true,
          estimatedSavings: '5-89 seconds'
        })
        
        // Clear currently fetching status
        preloadStats.value.currentlyFetchingFullSize = null
        
        // Update progress immediately when a preload completes
        trackProgressiveLoadingStats()
      }).catch((error) => {
        // Failed to preload full resolution, but thumbnail is still available
        debugGallery('BACKGROUND_PRELOAD_FAILED', `Background preload failed for ${photo.name}`, {
          error: error.message,
          fullSizeFilename: fullSizeFilename,
          fallbackAvailable: true
        })
        
        // Clear currently fetching status on error
        preloadStats.value.currentlyFetchingFullSize = null
      })
    } else {
      // No separate full-size version available
      imgElement.dataset.fullLoaded = 'true'
    }
    
  } catch (error) {
    // Failed to load optimized image
    debugError('progressive-loading', `Failed to load thumbnail for ${photo.name}`, error)
  }
}

const getPhotoDisplayName = (filename) => {
  return filename.split('/').pop() || filename
}

const handleImageError = (event) => {
  const imgElement = event.target
  const originalSrc = imgElement.src
  const photoName = imgElement.alt || 'unknown'
  
  console.error('❌ Image failed to load:', photoName, 'from', originalSrc)
  
  // Set fallback image
  event.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjVmNWY1Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIG5vdCBmb3VuZDwvdGV4dD48L3N2Zz4='
}

const handleImageLoadStart = (event) => {
  const imgElement = event.target
  const photoName = imgElement.alt || 'unknown'
  
  console.log('🔄 Started loading image:', photoName)
}

const handleImageLoad = (event) => {
  const imgElement = event.target
  const photoName = imgElement.alt || 'unknown'
  
  console.log('✅ Image loaded successfully:', photoName)
}

const handleHeicImageError = async (event, photo) => {
  // Since backend converts everything to AVIF, show fallback image
  event.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjVmNWY1Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIHVuYXZhaWxhYmxlPC90ZXh0Pjwvc3ZnPg=='
}

const openPhoto = async (photo) => {
  // photo.name is a thumbnail file (e.g., "IMG_8848_thumbnail.avif")
  // We need to find the corresponding full-size file in lightbox
  
  let targetPhotoIndex = -1
  
  if (/_thumbnail\.avif$/i.test(photo.name)) {
    // Convert thumbnail name to full-size name
    const fullSizeFilename = photo.name.replace(/_thumbnail\.avif$/i, '_full.avif')
    targetPhotoIndex = lightboxPhotos.value.findIndex(p => p.name === fullSizeFilename)
    
    debugLightbox('LIGHTBOX_MAPPING', `Mapping thumbnail to full-size for lightbox`, {
      clickedThumbnail: photo.name,
      correspondingFullSize: fullSizeFilename,
      foundIndex: targetPhotoIndex
    })
  } else {
    // If it's already a full-size file, search directly
    targetPhotoIndex = lightboxPhotos.value.findIndex(p => p.name === photo.name)
  }
  
  if (targetPhotoIndex === -1) {
    debugError('lightbox', `Could not find corresponding full-size photo for: ${photo.name}`, {
      lightboxPhotos: lightboxPhotos.value.map(p => p.name)
    })
    return
  }
  
  // Check if full-size image was already preloaded in background
  const gridImage = document.querySelector(`img[alt="${photo.name}"][data-full-loaded="true"]`)
  const isPreloaded = gridImage && gridImage.dataset.fullLoaded === 'true'
  
  debugLightbox('LIGHTBOX_OPENING', `Opening lightbox for ${photo.name}`, {
    photoIndex: targetPhotoIndex,
    totalPhotos: lightboxPhotos.value.length,
    preloadedInBackground: isPreloaded,
    expectedLoadTime: isPreloaded ? 'instant' : '5-89 seconds'
  })
  
  // Open the lightbox directly with AVIF file
  currentPhotoIndex.value = targetPhotoIndex
  showLightbox.value = true
  
  // If image wasn't preloaded, show loading state briefly
  if (!isPreloaded) {
    lightboxLoading.value = true
  }
  
  // Add keyboard event listener
  document.addEventListener('keydown', handleLightboxKeyboard)
}

const closeLightbox = () => {
  showLightbox.value = false
  lightboxLoading.value = false
  
  // Remove keyboard event listener
  document.removeEventListener('keydown', handleLightboxKeyboard)
}

const nextPhoto = () => {
  if (currentPhotoIndex.value < lightboxPhotos.value.length - 1) {
    // Check if next image was preloaded
    const nextPhoto = lightboxPhotos.value[currentPhotoIndex.value + 1]
    const nextGridImage = document.querySelector(`img[alt="${nextPhoto.name}"][data-full-loaded="true"]`)
    const isNextPreloaded = nextGridImage && nextGridImage.dataset.fullLoaded === 'true'
    
    debugLightbox('LIGHTBOX_NAVIGATION', `Navigating to next photo: ${nextPhoto.name}`, {
      currentIndex: currentPhotoIndex.value,
      nextIndex: currentPhotoIndex.value + 1,
      preloadedInBackground: isNextPreloaded,
      expectedLoadTime: isNextPreloaded ? 'instant' : '5-89 seconds'
    })
    
    // Show loading state if next image wasn't preloaded
    if (!isNextPreloaded) {
      lightboxLoading.value = true
    }
    
    currentPhotoIndex.value++
  }
}

const previousPhoto = () => {
  if (currentPhotoIndex.value > 0) {
    // Check if previous image was preloaded
    const prevPhoto = lightboxPhotos.value[currentPhotoIndex.value - 1]
    const prevGridImage = document.querySelector(`img[alt="${prevPhoto.name}"][data-full-loaded="true"]`)
    const isPrevPreloaded = prevGridImage && prevGridImage.dataset.fullLoaded === 'true'
    
    debugLightbox('LIGHTBOX_NAVIGATION', `Navigating to previous photo: ${prevPhoto.name}`, {
      currentIndex: currentPhotoIndex.value,
      prevIndex: currentPhotoIndex.value - 1,
      preloadedInBackground: isPrevPreloaded,
      expectedLoadTime: isPrevPreloaded ? 'instant' : '5-89 seconds'
    })
    
    // Show loading state if previous image wasn't preloaded
    if (!isPrevPreloaded) {
      lightboxLoading.value = true
    }
    
    currentPhotoIndex.value--
  }
}

const handleLightboxKeyboard = (event) => {
  switch (event.key) {
    case 'Escape':
      closeLightbox()
      break
    case 'ArrowLeft':
      previousPhoto()
      break
    case 'ArrowRight':
      nextPhoto()
      break
  }
}

const handleLightboxImageError = async (event) => {
  // Since backend handles all conversions to AVIF, show generic error
  event.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjVmNWY1Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIGNhbm5vdCBiZSBsb2FkZWQ8L3RleHQ+PC9zdmc+'
}

const triggerFileInput = () => {
  fileInput.value?.click()
}

const handleFileSelect = (event) => {
  const files = Array.from(event.target.files)
  addFiles(files)
}

const handleDrop = (event) => {
  event.preventDefault()
  isDragging.value = false
  const files = Array.from(event.dataTransfer.files)
  addFiles(files)
}

const addFiles = (files) => {
  const imageFiles = files.filter(file => file.type.startsWith('image/'))
  selectedFiles.value.push(...imageFiles)
  
  if (imageFiles.length !== files.length) {
    alert(`${files.length - imageFiles.length} files were skipped (only image files are allowed)`)
  }
}

const removeFile = (index) => {
  selectedFiles.value.splice(index, 1)
}

const uploadPhotos = async () => {
  if (selectedFiles.value.length === 0) return
  
  // Check permission before proceeding
  if (!authService.canPerformAction('upload_photos')) {
    error.value = 'You do not have permission to upload photos'
    return
  }
  
  uploading.value = true
  uploadProgress.value = 0
  error.value = null
  
  // Initialize progress tracking for each file
  fileUploadProgress.value = {}
  uploadedFiles.value = new Set()
  failedFiles.value = new Set()
  
  selectedFiles.value.forEach(file => {
    fileUploadProgress.value[file.name] = 0
  })
  
  try {
    uploadStatus.value = `Starting upload of ${selectedFiles.value.length} files...`
    
    console.log(`[UPLOAD] Uploading ${selectedFiles.value.length} files to ${BUCKET_NAME}/${props.albumName}`)
    
    // **UPDATED: Use the new async upload system**
    const response = await apiService.uploadFile(
      BUCKET_NAME, 
      selectedFiles.value, 
      props.albumName
    )
    
    console.log('[UPLOAD] Upload response:', response)
    
    // Check if we got async job response (202 Accepted)
    if (response.success && response.data && response.data.processingAsync && response.data.jobId) {
      // **NEW: True async upload - got job ID immediately**
      const jobId = response.data.jobId
      uploadStatus.value = `Upload queued! Processing ${response.data.totalFiles} files...`
      uploadProgress.value = 5 // Show initial progress
      
      console.log(`[UPLOAD] Got job ID immediately: ${jobId}`)
      console.log(`[UPLOAD] Starting background polling for job: ${jobId}`)
      
      // Poll job status with real-time updates
      try {
        const finalJob = await apiService.pollJobStatus(
          jobId,
          (job) => {
            // Real-time progress updates
            const progressPercent = job.progress.total > 0 
              ? Math.round((job.progress.processed / job.progress.total) * 100)
              : 10;
            
            uploadProgress.value = Math.max(progressPercent, 10); // Minimum 10% to show activity
            
            if (job.status === 'queued') {
              uploadStatus.value = `Queued for processing... (${job.progress.total} files)`
            } else if (job.status === 'processing') {
              uploadStatus.value = `Converting images... (${job.progress.processed}/${job.progress.total})`
            }
            
            console.log(`[UPLOAD] Job ${jobId} status:`, {
              status: job.status,
              progress: `${job.progress.processed}/${job.progress.total}`,
              percent: progressPercent
            })
          },
          45, // Max 45 attempts (1.5 minutes total)
          2000 // Poll every 2 seconds
        )
        
        // Handle final job completion
        if (finalJob.status === 'completed') {
          uploadProgress.value = 100
          const totalVariants = finalJob.results ? finalJob.results.length : finalJob.progress.processed
          uploadStatus.value = `Success! ${totalVariants} image variants created`
          
          // Mark all files as successfully uploaded
          selectedFiles.value.forEach(file => {
            uploadedFiles.value.add(file.name)
            fileUploadProgress.value[file.name] = 100
          })
          
          console.log(`[UPLOAD] Job ${jobId} completed successfully!`, finalJob.results)
          
        } else if (finalJob.status === 'failed') {
          uploadProgress.value = 100
          uploadStatus.value = `Upload failed - some files could not be processed`
          
          // Handle partial success/failure
          if (finalJob.results && finalJob.results.length > 0) {
            finalJob.results.forEach(result => {
              const fileName = result.originalName
              uploadedFiles.value.add(fileName)
              fileUploadProgress.value[fileName] = 100
            })
          }
          
          if (finalJob.errors && finalJob.errors.length > 0) {
            finalJob.errors.forEach(error => {
              failedFiles.value.add(error.filename)
              fileUploadProgress.value[error.filename] = -1
            })
          }
          
          console.error(`[UPLOAD] Job ${jobId} failed:`, finalJob.errors)
        }
        
      } catch (pollError) {
        console.error('[UPLOAD] Job polling failed:', pollError)
        uploadStatus.value = `Upload status unknown - polling failed: ${pollError.message}`
        uploadProgress.value = 100
      }
      
    } else if (response.success) {
      // **FALLBACK: Direct/synchronous upload response**
      console.log('[UPLOAD] Direct upload response (no async job)')
      uploadProgress.value = 100
      
      if (response.data && response.data.uploadedCount) {
        uploadStatus.value = `${response.data.uploadedCount} files uploaded successfully!`
        selectedFiles.value.forEach(file => {
          uploadedFiles.value.add(file.name)
          fileUploadProgress.value[file.name] = 100
        })
      } else {
        uploadStatus.value = 'Upload completed!'
      }
      
    } else {
      throw new Error(response.error || 'Upload failed')
    }
    
    // Close dialog and refresh photos after a delay
    setTimeout(() => {
      closeUploadDialog()
      loadPhotos()
    }, 2500)
    
  } catch (err) {
    error.value = `Upload failed: ${err.message}`
    console.error('[UPLOAD] Upload error:', err)
  } finally {
    uploading.value = false
  }
}

const confirmDeletePhoto = (photo) => {
  // Check permission before showing dialog
  if (!authService.canPerformAction('delete_photo')) {
    error.value = 'You do not have permission to delete photos'
    return
  }
  
  photoToDelete.value = photo
  showDeletePhotoDialog.value = true
}

const deletePhoto = async () => {
  if (!photoToDelete.value) return
  
  deletingPhoto.value = true
  error.value = null
  
  try {
    const response = await apiService.deleteObject(BUCKET_NAME, photoToDelete.value.name)
    
    if (response.success) {
      await loadPhotos() // Refresh the list
      closeDeletePhotoDialog()
    } else {
      throw new Error(response.error || 'Failed to delete photo')
    }
  } catch (err) {
    error.value = `Failed to delete photo: ${err.message}`
  } finally {
    deletingPhoto.value = false
  }
}

const closeUploadDialog = () => {
  showUploadDialog.value = false
  selectedFiles.value = []
  uploading.value = false
  uploadProgress.value = 0
  uploadStatus.value = ''
  isDragging.value = false
  fileUploadProgress.value = {}
  uploadedFiles.value = new Set()
  failedFiles.value = new Set()
}

const closeDeletePhotoDialog = () => {
  showDeletePhotoDialog.value = false
  photoToDelete.value = null
  deletingPhoto.value = false
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Cleanup function for blob URLs (now mostly unused since backend handles conversions)
const cleanupBlobUrls = () => {
  // Function kept for compatibility but mostly unused now
}

// Performance monitoring with 3-step progressive loading tracking
const trackImageLoadTime = (photoName, startTime) => {
  const loadTime = Date.now() - startTime
  
  // Track slow loading images (>2 seconds) - could be used for analytics
  if (loadTime > 2000) {
    debugPerformance('Slow image load detected', { photoName, loadTime })
  }
  
  // Track thumbnail loading performance (should be <1 second)
  if (loadTime < 1000) {
    debugPerformance('Fast thumbnail load', { photoName, loadTime, type: 'thumbnail' })
  }
}

// Track progressive loading statistics
const trackProgressiveLoadingStats = () => {
  const allImages = document.querySelectorAll('.photo-image')
  const preloadedImages = document.querySelectorAll('.photo-image[data-full-loaded="true"]')
  const thumbnailImages = allImages.length
  const preloadedCount = preloadedImages.length
  const preloadPercentage = thumbnailImages > 0 ? Math.round((preloadedCount / thumbnailImages) * 100) : 0
  
  // Update reactive stats for UI display - preserve existing tracking properties
  preloadStats.value = {
    thumbnails: thumbnailImages,
    preloaded: preloadedCount,
    percentage: preloadPercentage,
    currentlyFetchingFullSize: preloadStats.value.currentlyFetchingFullSize, // Preserve current file being fetched
    readyImages: preloadStats.value.readyImages // Preserve ready images list
  }
  
  debugPerformance('PROGRESSIVE_LOADING_STATS', 'Current progressive loading statistics', {
    totalThumbnails: thumbnailImages,
    preloadedFullSize: preloadedCount,
    preloadPercentage: `${preloadPercentage}%`,
    strategy: '3-step-progressive',
    expectedSpeedup: 'Up to 90x faster lightbox loading'
  })
  
  return {
    thumbnails: thumbnailImages,
    preloaded: preloadedCount,
    percentage: preloadPercentage
  }
}

// Aggressive background preloading: Start immediately after thumbnails load
const startAggressivePreloading = () => {
  const imageElements = document.querySelectorAll('.photo-image')
  
  debugGallery('AGGRESSIVE_PRELOAD_START', `Starting aggressive background preloading for ${imageElements.length} images`, {
    strategy: 'immediate-background-preload',
    expectedImprovement: 'instant-lightbox-for-all-images'
  })
  
  imageElements.forEach((img, index) => {
    const photoName = img.alt
    const photo = visiblePhotos.value.find(p => p.name === photoName)
    
    if (photo) {
      // Add small delay between images to avoid overwhelming the browser
      setTimeout(() => {
        debugGallery('AGGRESSIVE_PRELOAD_ITEM', `Starting preload ${index + 1}/${imageElements.length}: ${photoName}`)
        loadImageProgressively(photo, img)
      }, index * 100) // 100ms delay between each image
    }
  })
}

// Batch image preloading for visible images with enhanced progressive loading
const preloadVisibleImages = () => {
  const imageElements = document.querySelectorAll('.photo-image[loading="lazy"]')
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target
        const startTime = Date.now()
        
        img.addEventListener('load', () => {
          trackImageLoadTime(img.alt, startTime)
        }, { once: true })
        
        // Enhanced: Start progressive loading for visible thumbnails
        const photoName = img.alt
        const photo = visiblePhotos.value.find(p => p.name === photoName)
        if (photo) {
          debugGallery('VISIBLE_IMAGE_DETECTED', `Image became visible: ${photoName}`, {
            element: img.className,
            progressive: 'starting'
          })
          loadImageProgressively(photo, img)
        }
        
        observer.unobserve(img)
      }
    })
  }, { 
    rootMargin: '100px', // Increased margin for earlier preloading
    threshold: 0.1 // Trigger when 10% visible
  })
  
  imageElements.forEach(img => observer.observe(img))
  
  debugGallery('INTERSECTION_OBSERVER_SETUP', `Observing ${imageElements.length} images for progressive loading`, {
    strategy: '3-step-progressive',
    rootMargin: '100px',
    threshold: 0.1
  })
}

// Simplified HEIC setup - no longer needed since we use server variants first
const setupHeicLazyConversion = () => {
  // This function is kept for compatibility but HEIC handling is now automatic
  // through the handleHeicImageError fallback system
}

const handleLightboxImageLoad = (event) => {
  const img = event.target
  if (img && img.naturalWidth && img.naturalHeight) {
    currentImageInfo.value = `${img.naturalWidth} × ${img.naturalHeight}`
  }
  
  // Hide loading state once image loads
  lightboxLoading.value = false
  
  debugLightbox('LIGHTBOX_IMAGE_LOADED', `Lightbox image loaded successfully`, {
    photoName: currentPhoto.value?.name,
    resolution: currentImageInfo.value,
    loadingTime: 'completed'
  })
}

// Show only thumbnail files in grid (filter out full-size files)
const visiblePhotos = computed(() => {
  // DEBUG: Log ALL files received from backend
  debugGallery('VISIBLE_PHOTOS_COMPUTED', `Computing visible photos from ${photos.value.length} total files:`, {
    totalFiles: photos.value.length,
    files: photos.value.map(f => ({
      name: f.name,
      size: f.size,
      type: f.name.split('.').pop().toUpperCase(),
      isThumbnail: /_thumbnail\.avif$/i.test(f.name),
      isFullSize: /_full\.avif$/i.test(f.name)
    }))
  })

  // Show only thumbnail files in grid for fast loading
  const result = photos.value.filter(photo => /_thumbnail\.avif$/i.test(photo.name))
  
  debugGallery('VISIBLE_PHOTOS_RESULT', `Filtered to ${result.length} thumbnail photos for grid display`, {
    thumbnails: result.map(f => f.name),
    strategy: 'thumbnails-only-in-grid'
  })
  return result
})

// Map thumbnails to full-size files for lightbox navigation
const lightboxPhotos = computed(() => {
  // For each thumbnail in the grid, find the corresponding full-size file
  const result = visiblePhotos.value.map(thumbnail => {
    // Convert thumbnail filename to full-size filename
    const fullSizeFilename = thumbnail.name.replace(/_thumbnail\.avif$/i, '_full.avif')
    
    // Find the full-size file in the photos array
    const fullSizePhoto = photos.value.find(photo => photo.name === fullSizeFilename)
    
    if (fullSizePhoto) {
      debugLightbox('LIGHTBOX_MAPPING', `Mapped thumbnail to full-size for lightbox`, {
        thumbnail: thumbnail.name,
        fullSize: fullSizePhoto.name,
        thumbnailSize: thumbnail.size,
        fullSizeSize: fullSizePhoto.size
      })
      return fullSizePhoto
    } else {
      // Fallback to thumbnail if no full-size version found
      debugLightbox('LIGHTBOX_FALLBACK', `No full-size found, using thumbnail for lightbox`, {
        thumbnail: thumbnail.name
      })
      return thumbnail
    }
  })
  
  debugLightbox('LIGHTBOX_PHOTOS_COMPUTED', `Computed ${result.length} lightbox photos from thumbnails`)
  return result
})

// Virtual scrolling is now based on visiblePhotos computed property
const currentPage = ref(1)
const paginatedVisiblePhotos = computed(() => {
  const endIndex = currentPage.value * ITEMS_PER_PAGE
  const result = visiblePhotos.value.slice(0, endIndex)
  
  debugPerformance('PAGINATION', `Page ${currentPage.value}: Showing ${result.length} of ${visiblePhotos.value.length} photos (${ITEMS_PER_PAGE} per page)`)
  
  return result
})

const loadMorePhotos = () => {
  if (paginatedVisiblePhotos.value.length < visiblePhotos.value.length) {
    currentPage.value++
  }
}

const resetVirtualScrolling = () => {
  currentPage.value = 1
}

// Intersection observer for infinite scroll
const setupInfiniteScroll = () => {
  const sentinel = document.querySelector('.load-more-trigger')
  if (!sentinel) return
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && paginatedVisiblePhotos.value.length < visiblePhotos.value.length) {
        debugGallery('Loading more photos', { 
          currentCount: paginatedVisiblePhotos.value.length, 
          totalCount: visiblePhotos.value.length 
        })
        loadMorePhotos()
      }
    })
  }, { threshold: 0.1 })
  
  observer.observe(sentinel)
}

// Lifecycle
onMounted(async () => {
  debugPerformance('COMPONENT_MOUNTED', `AlbumDetail component mounted for album: ${props.albumName}`)
  
  await loadPhotos()
  
  debugPerformance('POST_LOAD_SETUP', 'Setting up 3-step progressive loading system')
  
  // Setup 3-step progressive loading system after images are loaded
  setTimeout(() => {
    // Start aggressive background preloading immediately
    startAggressivePreloading()
    
    // Also setup intersection observer for additional optimizations
    preloadVisibleImages()
    setupInfiniteScroll()
    setupHeicLazyConversion() // Setup HEIC lazy conversion
    
    // Track initial progressive loading statistics
    trackProgressiveLoadingStats()
    
    // Set up periodic tracking every 2 seconds to monitor progress
    progressTracker.value = setInterval(() => {
      const stats = trackProgressiveLoadingStats()
      
      // Stop tracking when we reach 100% preload percentage
      if (stats.percentage >= 100) {
        clearInterval(progressTracker.value)
        progressTracker.value = null
        debugPerformance('PRELOAD_COMPLETE', 'All images preloaded - stopping progress tracker')
      }
    }, 2000)
    
    debugPerformance('SETUP_COMPLETE', 'Completed AGGRESSIVE 3-step progressive loading setup', {
      strategy: 'immediate-background-preload-all-images',
      expectedImprovements: {
        gridLoadTime: '90x faster (from 5-89s to <1s)',
        lightboxLoadTime: 'INSTANT for ALL images (aggressive preloading)',
        userExperience: 'Seamless progressive loading with immediate background preload'
      }
    })
  }, 100)
})

onUnmounted(() => {
  cleanupBlobUrls()
  // Clean up keyboard listener if lightbox is open
  document.removeEventListener('keydown', handleLightboxKeyboard)
})
</script>

<style scoped>
.album-detail {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.album-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e0e0e0;
}

.btn-back {
  background: #f5f5f5;
  color: #333;
  border: 1px solid #ddd;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.btn-back:hover {
  background: #e0e0e0;
}

.album-info h1 {
  font-size: 2rem;
  font-weight: 600;
  color: #333;
  margin: 0;
}

.album-info .subtitle {
  font-size: 1rem;
  color: #666;
  margin: 0.25rem 0 0 0;
}

.btn-primary {
  background: #2196f3;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

.btn-primary:hover:not(:disabled) {
  background: #1976d2;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f5f5f5;
  color: #333;
  border: 1px solid #ddd;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: #e0e0e0;
}

.btn-danger {
  background: #f44336;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.btn-danger:hover:not(:disabled) {
  background: #d32f2f;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading {
  text-align: center;
  padding: 3rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #2196f3;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error {
  text-align: center;
  padding: 2rem;
  color: #f44336;
}

.empty-state {
  text-align: center;
  padding: 4rem 2rem;
}

.empty-icon {
  font-size: 4rem;
  color: #ccc;
  margin-bottom: 1rem;
}

.empty-state h3 {
  font-size: 1.5rem;
  color: #333;
  margin: 0;
}

.empty-state p {
  color: #666;
  margin: 0 0 2rem 0;
}

/* Performance optimizations */
.photos-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  /* Enable hardware acceleration */
  transform: translateZ(0);
  will-change: scroll-position;
}

.photo-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s ease;
  cursor: pointer;
  /* Enable hardware acceleration for hover effects */
  will-change: transform, box-shadow;
  /* Optimize repaint areas */
  contain: layout;
}

.photo-card:hover {
  border-color: #2196f3;
  box-shadow: 0 4px 12px rgba(33, 150, 243, 0.1);
  transform: translateY(-2px) translateZ(0);
}

/* Image loading optimization */
.photo-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.3s ease;
  /* Improve image rendering */
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
  /* Optimize for thumbnails */
  filter: contrast(1.02) saturate(1.05);
}

/* Loading states with smooth transitions */
.photo-image.loading {
  opacity: 0;
  filter: blur(2px);
}

.photo-image.loaded {
  opacity: 1;
  filter: none;
}

.photo-thumbnail {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  background: #f8f9fa;
}

.photo-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.3s ease;
}

.image-loading-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8f9fa;
  color: #ccc;
  font-size: 2rem;
  z-index: 1;
  opacity: 1;
  transition: opacity 0.3s ease;
}

.photo-image:not([src=""]) + .image-loading-placeholder {
  opacity: 0;
  pointer-events: none;
}

/* Progressive loading states */
.photo-image[data-full-loaded="true"] {
  filter: none;
}

.photo-image:not([data-full-loaded="true"]) {
  filter: blur(0.5px) brightness(1.1);
}

/* Lazy loading optimization */
.photo-image[loading="lazy"] {
  content-visibility: auto;
  contain-intrinsic-size: 200px 200px;
}

.heic-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 0.5rem;
  background: #f8f9fa;
  color: #2196f3;
  font-size: 0.9rem;
}

.heic-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 0.5rem;
  background: #ffeaa7;
  color: #e17055;
  font-size: 0.8rem;
  padding: 1rem;
  text-align: center;
}

.heic-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 0.5rem;
  background: #f0f0f0;
  color: #999;
  font-size: 0.9rem;
}

.download-btn {
  background: #2196f3;
  color: white;
  border: none;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.7rem;
  margin-top: 0.5rem;
}

.download-btn:hover {
  background: #1976d2;
}

/* HEIC Conversion Status Indicators */
.heic-conversion-status {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  pointer-events: none;
}

.heic-conversion-status.converting {
  background: rgba(33, 150, 243, 0.9);
  color: white;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  gap: 4px;
}

.heic-conversion-status.converted {
  background: rgba(76, 175, 80, 0.9);
  color: white;
  padding: 4px 6px;
  border-radius: 50%;
  font-size: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  animation: checkmarkShow 2s ease-in-out;
}

.heic-conversion-status.error {
  background: rgba(244, 67, 54, 0.9);
  color: white;
  padding: 4px 6px;
  border-radius: 50%;
  font-size: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.conversion-spinner {
  display: flex;
  align-items: center;
  gap: 4px;
}

.conversion-text {
  font-size: 0.7rem;
  font-weight: 500;
}

@keyframes checkmarkShow {
  0% { opacity: 0; transform: scale(0.5); }
  20% { opacity: 1; transform: scale(1.1); }
  40% { opacity: 1; transform: scale(1); }
  90% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1); }
}

.photo-info {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.photo-name {
  font-weight: 500;
  color: #333;
  font-size: 0.9rem;
  word-break: break-word;
}

.photo-size {
  font-size: 0.8rem;
  color: #666;
}

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: white;
  border-radius: 12px;
  padding: 2rem;
  min-width: 400px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.upload-dialog {
  min-width: 500px;
}

.dialog h3 {
  margin: 0 0 1.5rem 0;
  color: #333;
}

.upload-zone {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 2rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  margin-bottom: 1.5rem;
}

.upload-zone:hover,
.upload-zone.dragging {
  border-color: #2196f3;
  background: #f3f9ff;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.upload-icon {
  font-size: 3rem;
  color: #ccc;
}

.upload-text {
  font-size: 1.1rem;
  font-weight: 500;
  margin: 0;
  color: #333;
}

.upload-hint {
  font-size: 0.9rem;
  color: #666;
  margin: 0;
}

.upload-progress {
  margin-bottom: 1.5rem;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: #f0f0f0;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-fill {
  height: 100%;
  background: #2196f3;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.9rem;
  color: #666;
  text-align: center;
  margin: 0;
}

.selected-files {
  margin-bottom: 1.5rem;
}

.selected-files h4 {
  margin: 0 0 1rem 0;
  color: #333;
}

.file-list {
  max-height: 200px;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  margin-bottom: 0.5rem;
  gap: 1rem;
}

.file-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.file-name {
  font-weight: 500;
  color: #333;
  font-size: 0.9rem;
  word-break: break-word;
}

.file-size {
  font-size: 0.8rem;
  color: #666;
  margin-top: 0.25rem;
}

.file-progress {
  display: flex;
  align-items: center;
  min-width: 120px;
  justify-content: flex-end;
}

.file-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  font-weight: 500;
}

.file-status.success {
  color: #4caf50;
}

.file-status.error {
  color: #f44336;
}

.file-status.uploading {
  color: #2196f3;
}

.file-status.waiting {
  color: #666;
}

.mini-progress-bar {
  width: 60px;
  height: 4px;
  background: #f0f0f0;
  border-radius: 2px;
  overflow: hidden;
}

.mini-progress-fill {
  height: 100%;
  background: #2196f3;
  transition: width 0.3s ease;
}

.btn-remove {
  background: #f44336;
  color: white;
  border: none;
  padding: 0.25rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.7rem;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.btn-remove:hover {
  background: #d32f2f;
}

.dialog-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
}

.warning {
  color: #ff9800;
  font-size: 0.9rem;
  margin: 1rem 0;
}

@media (max-width: 768px) {
  .album-detail {
    padding: 1rem;
  }
  
  .album-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }
  
  .album-info {
    text-align: center;
  }
  
  .photos-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
  
  .dialog {
    min-width: auto;
    margin: 1rem;
  }
  
  .upload-dialog {
    min-width: auto;
  }
  
  .dialog-actions {
    flex-direction: column;
  }
}

/* Lightbox Styles */
.lightbox-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  cursor: pointer;
}

.lightbox-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

.lightbox-content {
  display: flex;
  flex-direction: column;
  max-width: 95vw;
  max-height: 95vh;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}

.lightbox-image-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 100%;
  height: calc(100% - 80px); /* Reserve space for info bar */
  min-height: 0; /* Allow shrinking */
}

.lightbox-image {
  max-width: 100%;
  max-height: calc(100vh - 120px); /* Account for info bar at bottom */
  width: auto;
  height: auto;
  object-fit: contain;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  display: block;
  margin: 0 auto;
}

.lightbox-loading,
.lightbox-heic-loading,
.lightbox-heic-error,
.lightbox-heic-converting {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: white;
  gap: 1rem;
  padding: 2rem;
  text-align: center;
}

.lightbox-loading i,
.lightbox-heic-loading i,
.lightbox-heic-converting i {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.lightbox-heic-converting {
  background: rgba(33, 150, 243, 0.1);
  border: 1px solid rgba(33, 150, 243, 0.3);
  border-radius: 8px;
  backdrop-filter: blur(10px);
}

.conversion-progress {
  width: 200px;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 1rem;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #2196f3, #21cbf3);
  border-radius: 2px;
  animation: progressIndeterminate 2s infinite linear;
}

@keyframes progressIndeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(200px); }
}

.lightbox-heic-error {
  color: #ffcdd2;
}

.lightbox-heic-error i {
  font-size: 3rem;
  margin-bottom: 1rem;
  color: #f44336;
}

.btn-download-lightbox {
  background: #2196f3;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  margin-top: 1rem;
  transition: background 0.2s ease;
}

.btn-download-lightbox:hover {
  background: #1976d2;
}

.lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: none;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  backdrop-filter: blur(10px);
  z-index: 100;
}

.lightbox-nav:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-50%) scale(1.1);
}

.lightbox-nav:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.lightbox-prev {
  left: 2rem;
}

.lightbox-next {
  right: 2rem;
}

.lightbox-close {
  position: absolute;
  top: 2rem;
  right: 2rem;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: none;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  backdrop-filter: blur(10px);
  z-index: 100;
}

.lightbox-close:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: scale(1.1);
}

.lightbox-info {
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(10px);
  color: white;
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-radius: 8px;
  margin-top: auto;
  flex-shrink: 0;
  width: 100%;
  max-width: 800px;
}

.lightbox-photo-details h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.lightbox-photo-meta {
  margin: 0;
  font-size: 0.9rem;
  opacity: 0.8;
}

.lightbox-actions {
  display: flex;
  gap: 0.75rem;
}

.btn-lightbox-action {
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  backdrop-filter: blur(10px);
}

.btn-lightbox-action:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: scale(1.1);
}

.btn-danger-action:hover {
  background: rgba(244, 67, 54, 0.8);
}

/* Mobile responsiveness for lightbox */
@media (max-width: 768px) {
  .lightbox-nav {
    width: 50px;
    height: 50px;
    font-size: 1.2rem;
  }
  
  .lightbox-prev {
    left: 1rem;
  }
  
  .lightbox-next {
    right: 1rem;
  }
  
  .lightbox-close {
    top: 1rem;
    right: 1rem;
    width: 40px;
    height: 40px;
    font-size: 1rem;
  }
  
  .lightbox-info {
    flex-direction: column;
    gap: 1rem;
    text-align: center;
    padding: 1rem;
  }
  
  .lightbox-content {
    max-width: 98vw;
    max-height: 98vh;
  }
  
  .lightbox-image {
    max-height: calc(100vh - 140px); /* More space for mobile info bar */
  }
  
  .lightbox-image-container {
    height: calc(100% - 100px); /* Adjust for mobile info bar */
  }
}

/* Preload Status Styles */
.preload-status {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  font-size: 0.9rem;
}

.preload-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.preload-header i {
  color: #2196f3;
  font-size: 1rem;
}

.preload-percentage {
  margin-left: auto;
  font-weight: 600;
  color: #2196f3;
}

.preload-progress-bar {
  width: 100%;
  height: 6px;
  background: #e9ecef;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.preload-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #2196f3, #21cbf3);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.preload-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.preload-status-text {
  color: #666;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.preload-status-text i {
  color: #2196f3;
}

.preload-current-file {
  color: #333;
  font-weight: 500;
  background: #e3f2fd;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  border-left: 3px solid #2196f3;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.85rem;
}

.preload-complete-text {
  color: #4caf50;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
}

.preload-complete-text i {
  color: #4caf50;
}

.preload-ready-list {
  margin-top: 0.75rem;
  border-top: 1px solid #e9ecef;
  padding-top: 0.75rem;
}

.ready-list-header {
  font-weight: 600;
  color: #333;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.ready-list-header i {
  color: #4caf50;
  font-size: 0.9rem;
}

.ready-images-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  max-height: 120px;
  overflow-y: auto;
}

.ready-image-item {
  background: #e8f5e8;
  color: #2e7d32;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.8rem;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  border: 1px solid #a5d6a7;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.ready-image-item i {
  color: #4caf50;
  font-size: 0.7rem;
}

@media (max-width: 768px) {
  .preload-status {
    padding: 0.75rem;
    margin-bottom: 1rem;
    font-size: 0.85rem;
  }
  
  .preload-header {
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  
  .preload-current-file {
    padding: 0.4rem 0.6rem;
    font-size: 0.8rem;
  }
  
  .ready-list-header {
    font-size: 0.85rem;
    margin-bottom: 0.4rem;
  }
  
  .ready-images-grid {
    gap: 0.4rem;
    max-height: 100px;
  }
  
  .ready-image-item {
    padding: 0.2rem 0.4rem;
    font-size: 0.75rem;
  }
}
</style>

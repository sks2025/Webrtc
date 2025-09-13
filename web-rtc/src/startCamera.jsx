import React, { useRef, useEffect, useState } from 'react';

const CameraComponent = () => {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // Start camera
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user' // 'user' for front camera, 'environment' for back camera
        },
        audio: false
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        setStream(mediaStream);
        setIsStreaming(true);
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      alert('Could not access camera. Please check permissions.');
    }
  };





  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => {
          track.stop();
        });
      }
    };
  }, [stream]);

  useEffect(() => {
    startCamera();
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6 rounded-lg shadow-lg">
      
      
      

      {/* Camera Feed */}
      <div className="flex flex-col items-center">
        <div className="relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`rounded-lg border-2 border-gray-300 ${
              isStreaming ? 'block' : 'hidden'
            }`}
            style={{ maxWidth: '100%', height: 'auto' }}
          />
          
        
        </div>

      

        {/* Status */}
        <div className="mt-4 text-center">
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
            isStreaming
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-600'
          }`}>
            {isStreaming ? '🟢 Camera Active' : '⚫ Camera Stopped'}
          </span>
        </div>
      </div>

     

     
    </div>
  );
};

export default CameraComponent;